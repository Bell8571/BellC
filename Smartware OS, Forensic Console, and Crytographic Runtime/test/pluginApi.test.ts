import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNodeTypeRegistry } from "../src/pluginApi.js";

describe("RFC-0006 NodeTypeRegistry", () => {
  it("registers, gets, and lists types", () => {
    const reg = createNodeTypeRegistry();
    const result = reg.registerNodeType({
      type: "http.request",
      version: "1.0.0",
      configSchema: { fields: { url: { type: "string", required: true } } },
    });
    assert.equal(result.ok, true);
    const found = reg.getNodeType("http.request");
    assert.equal(found?.version, "1.0.0");
    assert.equal(found?.configSchema.fields["url"]?.required, true);
    assert.equal(reg.listNodeTypes().length, 1);
  });

  it("identical re-register is a no-op", () => {
    const reg = createNodeTypeRegistry();
    const payload = {
      type: "task",
      version: "1.0.0",
      configSchema: { fields: {} },
    };
    assert.equal(reg.registerNodeType(payload).ok, true);
    assert.equal(reg.registerNodeType(payload).ok, true);
    assert.equal(reg.listNodeTypes().length, 1);
  });

  it("rejects empty type", () => {
    const reg = createNodeTypeRegistry();
    const result = reg.registerNodeType({
      type: "",
      version: "1.0.0",
      configSchema: { fields: {} },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "INVALID_REGISTRATION");
    }
  });

  it("rejects a breaking duplicate type", () => {
    const reg = createNodeTypeRegistry();
    reg.registerNodeType({
      type: "task",
      version: "1.0.0",
      configSchema: { fields: {} },
    });
    const result = reg.registerNodeType({
      type: "task",
      version: "2.0.0",
      configSchema: { fields: { x: { type: "string", required: true } } },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "DUPLICATE_TYPE");
      assert.equal(result.type, "task");
    }
  });

  it("getNodeType returns undefined for unknown types", () => {
    const reg = createNodeTypeRegistry();
    assert.equal(reg.getNodeType("missing"), undefined);
  });
});
