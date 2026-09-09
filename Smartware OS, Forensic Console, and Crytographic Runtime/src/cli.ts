#!/usr/bin/env node
/**
 * smartware compile | run | inspect | portal start | demo
 * Feature flags: SMARTWARE_DAG_COMPILER=0, SMARTWARE_DAG_VISUALIZER=0, SMARTWARE_DAG_BRANCHING=0
 */

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { compile, parse } from "./dagCompiler.js";
import { createNodeTypeRegistry } from "./pluginApi.js";
import { runWorkflow } from "./runtime.js";
import { createDagVisualizer, renderFrameText, type TraceRecord } from "./dagVisualizer.js";
import { startPortal } from "./portal.js";

function usage(): never {
  process.stderr.write(
    "usage:\n  smartware compile <workflow.json|yaml>\n  smartware run <workflow.json|yaml> [--trace <path>] [--durable <path>]\n  smartware inspect --trace <path>\n  smartware portal start [--host 127.0.0.1] [--port 8787] [--allow-remote]\n  smartware demo\n",
  );
  process.exit(1);
}

function flagOff(name: string): boolean {
  return process.env[name] === "0";
}

function loadSource(filePath: string): { source: string; format: "json" | "yaml" } {
  const ext = extname(filePath).toLowerCase();
  const format = ext === ".yaml" || ext === ".yml" ? "yaml" : "json";
  return { source: readFileSync(filePath, "utf8"), format };
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

const argv = process.argv.slice(2);
const cmd = argv[0];

if (cmd === "compile") {
  if (typeof argv[1] !== "string") {
    usage();
  }
  if (flagOff("SMARTWARE_DAG_COMPILER")) {
    process.stderr.write("SMARTWARE_DAG_COMPILER=0; DAG compiler disabled\n");
    process.exit(2);
  }
  const { source, format } = loadSource(argv[1]);
  const parsed = parse(source, format);
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: parsed.errors }, null, 2)}\n`);
    process.exit(1);
  }
  if (flagOff("SMARTWARE_DAG_BRANCHING")) {
    for (const node of Object.values(parsed.definition.nodes)) {
      delete node.control;
    }
  }
  const result = compile(parsed.definition, taskRegistry());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (cmd === "run") {
  if (typeof argv[1] !== "string") {
    usage();
  }
  if (flagOff("SMARTWARE_DAG_COMPILER")) {
    process.stderr.write("SMARTWARE_DAG_COMPILER=0; DAG compiler disabled\n");
    process.exit(2);
  }
  let trace: string | undefined;
  let durable: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--trace" && typeof argv[i + 1] === "string") {
      trace = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--durable" && typeof argv[i + 1] === "string") {
      durable = argv[i + 1];
      i += 1;
    }
  }
  const { source, format } = loadSource(argv[1]);
  const parsed = parse(source, format);
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: parsed.errors }, null, 2)}\n`);
    process.exit(1);
  }
  const result = await runWorkflow(parsed.definition, taskRegistry(), {
    traceLogPath: trace,
    durablePath: durable,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (cmd === "inspect") {
  if (flagOff("SMARTWARE_DAG_VISUALIZER")) {
    process.stderr.write("SMARTWARE_DAG_VISUALIZER=0; visualizer disabled\n");
    process.exit(2);
  }
  if (argv[1] !== "--trace" && argv[1] !== "--live") {
    usage();
  }
  const path = argv[2];
  if (typeof path !== "string") {
    usage();
  }
  const records: TraceRecord[] = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TraceRecord);
  const vis = createDagVisualizer();
  const frames = vis.replay(records);
  const last = frames[frames.length - 1];
  if (!last) {
    process.stderr.write("empty trace\n");
    process.exit(1);
  }
  process.stdout.write(renderFrameText(last));
  process.exit(0);
}

if (cmd === "portal") {
  if (argv[1] !== "start") {
    usage();
  }
  let host = "127.0.0.1";
  let port = 8787;
  let allowRemote = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--host" && typeof argv[i + 1] === "string") {
      host = argv[i + 1]!;
      i += 1;
    } else if (argv[i] === "--port" && typeof argv[i + 1] === "string") {
      port = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--allow-remote") {
      allowRemote = true;
    } else {
      usage();
    }
  }
  const started = await startPortal({ host, port, allowRemote });
  if (!started.ok) {
    process.stderr.write(`${started.code}: ${started.message}\n`);
    process.exit(started.code === "DENIED" ? 2 : 1);
  }
  process.stdout.write(`Smartware portal listening at ${started.portal.url}\n`);
  process.stdout.write("Local-only by default. Ctrl+C to stop.\n");
  await new Promise<void>(() => {
    /* keep process alive until signal */
  });
}

if (cmd === "demo") {
  const { runProductDemo } = await import("./productDemo.js");
  const report = await runProductDemo();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

usage();
