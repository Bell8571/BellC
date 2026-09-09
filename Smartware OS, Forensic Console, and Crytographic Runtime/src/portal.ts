/**
 * RFC-0016 Developer Portal v1.
 * Local-only HTTP UI: visual DAG editor + monitoring.
 * No phone-home. Default bind 127.0.0.1.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { compile, type CompileResult, type WorkflowDefinition } from "./dagCompiler.js";
import { createNodeTypeRegistry } from "./pluginApi.js";
import { createDagVisualizer, renderFrameText } from "./dagVisualizer.js";

export const PORTAL_VERSION = "1.0.0-m33" as const;

export interface PortalStartOptions {
  host?: string;
  port?: number;
  /** Explicit opt-in to bind non-loopback. Default false. */
  allowRemote?: boolean;
}

export interface MonitorSnapshot {
  updatedAt: string;
  workflowId?: string;
  terminal?: string;
  nodeStates?: Record<string, string>;
  graphText?: string;
  note?: string;
}

export interface PortalHandle {
  host: string;
  port: number;
  url: string;
  server: Server;
  getMonitor(): MonitorSnapshot | undefined;
  close(): Promise<void>;
}

export type PortalStartResult =
  | { ok: true; portal: PortalHandle }
  | { ok: false; code: "DENIED" | "INVALID" | "BIND_FAILED"; message: string };

function isLoopback(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

function taskRegistry() {
  const registry = createNodeTypeRegistry();
  registry.registerNodeType({
    type: "task",
    version: "1.0.0",
    configSchema: { fields: {} },
  });
  return registry;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function portalHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Smartware Portal</title>
<style>
:root {
  --ink: #1a2332;
  --muted: #5a6a7a;
  --paper: #f3efe6;
  --panel: #fffdf8;
  --line: #c8bba8;
  --accent: #0f6b5c;
  --warn: #9a3412;
  --mono: "IBM Plex Mono", "Cascadia Code", "Consolas", monospace;
  --sans: "Source Serif 4", "Iowan Old Style", "Palatino Linotype", Georgia, serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--ink);
  background:
    radial-gradient(1200px 600px at 10% -10%, #e7f0ec 0%, transparent 55%),
    linear-gradient(180deg, #ebe4d6 0%, var(--paper) 40%, #e4ddd0 100%);
  font-family: var(--sans);
}
header {
  padding: 2.5rem 1.5rem 1rem;
  max-width: 1100px;
  margin: 0 auto;
}
header h1 {
  margin: 0;
  font-size: clamp(2.4rem, 5vw, 3.6rem);
  letter-spacing: -0.03em;
  font-weight: 600;
}
header p {
  margin: 0.6rem 0 0;
  color: var(--muted);
  max-width: 36rem;
  font-size: 1.05rem;
}
main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 1.5rem 3rem;
  display: grid;
  gap: 1.25rem;
}
@media (min-width: 900px) {
  main { grid-template-columns: 1.1fr 0.9fr; }
}
section {
  background: var(--panel);
  border: 1px solid var(--line);
  padding: 1rem 1.1rem 1.2rem;
}
section h2 {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-family: var(--mono);
  color: var(--accent);
}
textarea, pre {
  width: 100%;
  min-height: 280px;
  font-family: var(--mono);
  font-size: 0.85rem;
  line-height: 1.45;
  border: 1px solid var(--line);
  background: #faf7f1;
  color: var(--ink);
  padding: 0.75rem;
  resize: vertical;
}
.actions { display: flex; gap: 0.6rem; margin: 0.75rem 0; flex-wrap: wrap; }
button {
  font-family: var(--mono);
  font-size: 0.85rem;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #f7fffc;
  padding: 0.55rem 0.9rem;
  cursor: pointer;
}
button.secondary {
  background: transparent;
  color: var(--accent);
}
#status { font-family: var(--mono); font-size: 0.8rem; color: var(--muted); }
#status.err { color: var(--warn); }
</style>
</head>
<body>
<header>
  <h1>Smartware</h1>
  <p>Local developer portal — edit a workflow, compile a DAG preview, and inspect monitoring without leaving your machine.</p>
</header>
<main>
  <section>
    <h2>Visual editor</h2>
    <textarea id="editor" spellcheck="false"></textarea>
    <div class="actions">
      <button id="compileBtn" type="button">Compile preview</button>
      <button id="monitorBtn" class="secondary" type="button">Refresh monitor</button>
    </div>
    <div id="status">Ready · local only</div>
  </section>
  <section>
    <h2>Graph / monitor</h2>
    <pre id="out">Compile to render the DAG frame.</pre>
  </section>
</main>
<script>
const sample = {
  id: "portal-demo",
  version: "1.0.0",
  entrypoints: ["a"],
  nodes: {
    a: { id: "a", type: "task", dependsOn: [], config: {} },
    b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
    c: { id: "c", type: "task", dependsOn: ["a"], config: {} }
  }
};
const editor = document.getElementById("editor");
const out = document.getElementById("out");
const status = document.getElementById("status");
editor.value = JSON.stringify(sample, null, 2);

async function compilePreview() {
  status.className = "";
  status.textContent = "Compiling…";
  let body;
  try { body = JSON.parse(editor.value); }
  catch (e) {
    status.className = "err";
    status.textContent = "Invalid JSON";
    return;
  }
  const res = await fetch("/api/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok) {
    status.className = "err";
    status.textContent = "Compile failed";
    out.textContent = JSON.stringify(data, null, 2);
    return;
  }
  status.textContent = "Compile ok · " + (data.graphText ? "graph rendered" : "ok");
  out.textContent = data.graphText || JSON.stringify(data.result, null, 2);
}

async function refreshMonitor() {
  const res = await fetch("/api/monitor");
  const data = await res.json();
  out.textContent = data.snapshot
    ? (data.snapshot.graphText || JSON.stringify(data.snapshot, null, 2))
    : "No monitor snapshot yet — compile first.";
  status.className = "";
  status.textContent = "Monitor refreshed";
}

document.getElementById("compileBtn").onclick = compilePreview;
document.getElementById("monitorBtn").onclick = refreshMonitor;
</script>
</body>
</html>`;
}

export function createPortalRequestHandler(state: {
  monitor: MonitorSnapshot | undefined;
  setMonitor: (s: MonitorSnapshot) => void;
  host: string;
  port: number;
}): (req: IncomingMessage, res: ServerResponse) => void {
  const registry = taskRegistry();

  return (req, res) => {
    const url = new URL(req.url ?? "/", `http://${state.host}:${state.port}`);
    const path = url.pathname;

    void (async () => {
      try {
        if (req.method === "GET" && path === "/") {
          sendHtml(res, portalHtml());
          return;
        }
        if (req.method === "GET" && path === "/api/health") {
          sendJson(res, 200, {
            ok: true,
            bind: `${state.host}:${state.port}`,
            version: PORTAL_VERSION,
            localOnly: isLoopback(state.host),
          });
          return;
        }
        if (req.method === "GET" && path === "/api/monitor") {
          sendJson(res, 200, { ok: true, snapshot: state.monitor ?? null });
          return;
        }
        if (req.method === "POST" && path === "/api/monitor") {
          const raw = await readBody(req);
          let body: Partial<MonitorSnapshot> = {};
          if (raw.trim()) {
            try {
              body = JSON.parse(raw) as Partial<MonitorSnapshot>;
            } catch {
              sendJson(res, 400, { ok: false, code: "INVALID", message: "invalid JSON" });
              return;
            }
          }
          const snapshot: MonitorSnapshot = {
            updatedAt: new Date().toISOString(),
            workflowId: body.workflowId,
            terminal: body.terminal,
            nodeStates: body.nodeStates,
            graphText: body.graphText,
            note: body.note ?? "client update",
          };
          state.setMonitor(snapshot);
          sendJson(res, 200, { ok: true, snapshot });
          return;
        }
        if (req.method === "POST" && path === "/api/compile") {
          const raw = await readBody(req);
          let definition: WorkflowDefinition;
          try {
            definition = JSON.parse(raw) as WorkflowDefinition;
          } catch {
            sendJson(res, 400, { ok: false, code: "INVALID", message: "invalid JSON" });
            return;
          }
          const result: CompileResult = compile(definition, registry);
          if (!result.ok) {
            sendJson(res, 200, { ok: false, result });
            return;
          }
          const vis = createDagVisualizer();
          vis.bind(result.graph, { liveRefreshMs: 200 });
          const frame = vis.frame();
          const graphText = renderFrameText(frame);
          const snapshot: MonitorSnapshot = {
            updatedAt: new Date().toISOString(),
            workflowId: result.graph.workflowId,
            graphText,
            note: "compile preview",
          };
          state.setMonitor(snapshot);
          sendJson(res, 200, { ok: true, result, graphText, snapshot });
          return;
        }
        sendJson(res, 404, { ok: false, code: "NOT_FOUND", message: "not found" });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          code: "ERROR",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  };
}

export function startPortal(options: PortalStartOptions = {}): Promise<PortalStartResult> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const allowRemote = options.allowRemote ?? false;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.resolve({
      ok: false,
      code: "INVALID",
      message: "port must be an integer 0–65535",
    });
  }
  if (!isLoopback(host) && !allowRemote) {
    return Promise.resolve({
      ok: false,
      code: "DENIED",
      message: "non-loopback bind requires allowRemote / --allow-remote",
    });
  }

  let monitor: MonitorSnapshot | undefined;
  const state = {
    get monitor() {
      return monitor;
    },
    setMonitor(s: MonitorSnapshot) {
      monitor = s;
    },
    host,
    port,
  };

  const server = createServer(createPortalRequestHandler(state));

  return new Promise((resolve) => {
    server.once("error", (err) => {
      resolve({
        ok: false,
        code: "BIND_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
    });
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort =
        typeof addr === "object" && addr && "port" in addr ? addr.port : port;
      state.port = boundPort;
      const handle: PortalHandle = {
        host,
        port: boundPort,
        url: `http://${host}:${boundPort}/`,
        server,
        getMonitor: () => (monitor ? { ...monitor, nodeStates: monitor.nodeStates ? { ...monitor.nodeStates } : undefined } : undefined),
        close: () =>
          new Promise((res, rej) => {
            server.close((e) => (e ? rej(e) : res()));
          }),
      };
      resolve({ ok: true, portal: handle });
    });
  });
}
