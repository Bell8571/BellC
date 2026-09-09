import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile, type NodeDefinition, type WorkflowDefinition } from "../src/dagCompiler.js";
import { createNodeTypeRegistry } from "../src/pluginApi.js";

function registry() {
  const r = createNodeTypeRegistry();
  r.registerNodeType({ type: "task", version: "1.0.0", configSchema: { fields: {} } });
  return r;
}

function randomDag(size: number, seed: number): WorkflowDefinition {
  let s = seed;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const nodes: Record<string, NodeDefinition> = {};
  const ids: string[] = [];
  for (let i = 0; i < size; i++) {
    const id = `n${i.toString().padStart(4, "0")}`;
    ids.push(id);
    const dependsOn: string[] = [];
    if (i > 0) {
      const predCount = 1 + Math.floor(rand() * Math.min(3, i));
      for (let p = 0; p < predCount; p++) {
        const pred = ids[Math.floor(rand() * i)];
        if (pred && !dependsOn.includes(pred)) {
          dependsOn.push(pred);
        }
      }
    }
    nodes[id] = { id, type: "task", dependsOn, config: {} };
  }
  return { id: `fuzz-${seed}`, version: "1.0.0", nodes, entrypoints: ["n0000"] };
}

describe("fuzz cycle + schema", () => {
  it("compiles 10_000 random DAGs", () => {
    const reg = registry();
    for (let i = 0; i < 10_000; i++) {
      const def = randomDag(12, 1000 + i);
      const result = compile(def, reg);
      assert.equal(result.ok, true, `seed ${1000 + i} failed`);
    }
  });

  it("detects a back-edge cycle in randomised graphs", () => {
    const reg = registry();
    for (let i = 0; i < 50; i++) {
      const def = randomDag(12, 5000 + i);
      const keys = Object.keys(def.nodes);
      const last = keys[keys.length - 1];
      const first = keys[0];
      if (!last || !first) {
        continue;
      }
      const lastNode = def.nodes[last];
      if (lastNode) {
        lastNode.dependsOn.push(first);
        def.nodes[first] = {
          ...def.nodes[first]!,
          dependsOn: [...(def.nodes[first]?.dependsOn ?? []), last],
        };
      }
      const result = compile(def, reg);
      assert.equal(result.ok, false, `cycle seed ${5000 + i} compiled`);
      if (!result.ok) {
        assert.ok(
          result.errors.some((e) => e.code === "CYCLE_DETECTED" || e.code === "MISSING_ENTRYPOINT"),
        );
      }
    }
  });
});
