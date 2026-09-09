import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startPortal } from "../src/portal.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.ts");

describe("developer portal (M3.3)", () => {
  it("starts on loopback and serves health + compile", async () => {
    const started = await startPortal({ host: "127.0.0.1", port: 0 });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const { portal } = started;
    try {
      const healthRes = await fetch(`${portal.url}api/health`);
      const health = (await healthRes.json()) as {
        ok: boolean;
        localOnly: boolean;
        version: string;
      };
      assert.equal(health.ok, true);
      assert.equal(health.localOnly, true);

      const htmlRes = await fetch(portal.url);
      const html = await htmlRes.text();
      assert.match(html, /Smartware/);
      assert.match(html, /Visual editor/);

      const compileRes = await fetch(`${portal.url}api/compile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "p",
          version: "1.0.0",
          entrypoints: ["a"],
          nodes: {
            a: { id: "a", type: "task", dependsOn: [], config: {} },
            b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
          },
        }),
      });
      const compiled = (await compileRes.json()) as {
        ok: boolean;
        graphText?: string;
      };
      assert.equal(compiled.ok, true);
      assert.ok(compiled.graphText && compiled.graphText.length > 0);

      const mon = await fetch(`${portal.url}api/monitor`);
      const monBody = (await mon.json()) as { ok: boolean; snapshot: { workflowId?: string } | null };
      assert.equal(monBody.ok, true);
      assert.ok(monBody.snapshot);
    } finally {
      await portal.close();
    }
  });

  it("denies non-loopback without allowRemote", async () => {
    const denied = await startPortal({ host: "0.0.0.0", port: 0 });
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.code, "DENIED");
  });

  it("CLI portal start --help-style usage includes portal", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", cli], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /portal start/);
  });
});
