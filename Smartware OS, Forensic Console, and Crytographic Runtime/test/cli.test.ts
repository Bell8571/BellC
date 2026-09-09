import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.ts");
const tmpDir = join(root, "test", ".tmp");

function runCompile(
  filePath: string,
  env: Record<string, string | undefined> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, "compile", filePath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("smartware compile CLI", () => {
  mkdirSync(tmpDir, { recursive: true });

  it("compiles a linear task workflow", () => {
    const file = join(tmpDir, "linear.json");
    writeFileSync(
      file,
      JSON.stringify({
        id: "linear",
        version: "1.0.0",
        entrypoints: ["a"],
        nodes: {
          a: { id: "a", type: "task", dependsOn: [], config: {} },
          b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
        },
      }),
    );
    const result = runCompile(file);
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as { ok: boolean; graph?: { executionOrder: string[][] } };
    assert.equal(body.ok, true);
    assert.deepEqual(body.graph?.executionOrder, [["a"], ["b"]]);
  });

  it("surfaces CYCLE_DETECTED", () => {
    const file = join(tmpDir, "cycle.json");
    writeFileSync(
      file,
      JSON.stringify({
        id: "cycle",
        version: "1.0.0",
        entrypoints: [],
        nodes: {
          a: { id: "a", type: "task", dependsOn: ["b"], config: {} },
          b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
        },
      }),
    );
    const result = runCompile(file);
    assert.equal(result.status, 1);
    const body = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };
    assert.equal(body.ok, false);
    assert.ok(body.errors.some((e) => e.code === "CYCLE_DETECTED"));
  });

  it("surfaces INVALID_NODE_TYPE for unregistered types", () => {
    const file = join(tmpDir, "unknown-type.json");
    writeFileSync(
      file,
      JSON.stringify({
        id: "unknown",
        version: "1.0.0",
        entrypoints: ["a"],
        nodes: {
          a: { id: "a", type: "http.request", dependsOn: [], config: {} },
        },
      }),
    );
    const result = runCompile(file);
    assert.equal(result.status, 1);
    const body = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };
    assert.ok(body.errors.some((e) => e.code === "INVALID_NODE_TYPE"));
  });

  it("exits 2 when SMARTWARE_DAG_COMPILER=0", () => {
    const file = join(tmpDir, "linear.json");
    const result = runCompile(file, { SMARTWARE_DAG_COMPILER: "0" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /SMARTWARE_DAG_COMPILER=0/);
  });
});
