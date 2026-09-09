import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAiCopilot } from "../src/aiCopilot.js";

describe("AI Co-Pilot research (RFC-0028)", () => {
  it("defaults disabled and fail-closes", async () => {
    const copilot = createAiCopilot({
      provider: { kind: "local" },
    });
    assert.equal(copilot.enabled(), false);
    const result = await copilot.suggestWorkflow("fetch then store");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DISABLED");
  });

  it("local provider authors and optimises offline", async () => {
    const copilot = createAiCopilot({
      enabled: true,
      provider: { kind: "local" },
    });
    const authored = await copilot.suggestWorkflow("http fetch then transform store");
    assert.equal(authored.ok, true);
    if (!authored.ok) return;
    assert.equal(authored.value.provider, "local");
    assert.ok(authored.value.nodes.length >= 1);

    const opt = await copilot.suggestOptimisations([
      { id: "a", type: "task", dependsOn: [] },
      { id: "b", type: "task", dependsOn: ["a"] },
      { id: "c", type: "task", dependsOn: ["a"] },
    ]);
    assert.equal(opt.ok, true);
    if (!opt.ok) return;
    assert.ok(opt.value.hints.some((h) => h.code === "PARALLEL_BATCH"));
  });

  it("grok requires customer apiKey when enabled", async () => {
    const copilot = createAiCopilot({
      enabled: true,
      provider: { kind: "grok" },
    });
    const result = await copilot.suggestWorkflow("build pipeline");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DENIED");
  });

  it("grok parses remote authoring JSON via injected fetch", async () => {
    const copilot = createAiCopilot({
      enabled: true,
      provider: { kind: "grok", apiKey: "customer-grok-key" },
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"nodes":[{"id":"n1","type":"task","dependsOn":[]}],"rationale":"grok ok"}',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const result = await copilot.suggestWorkflow("simple task");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.provider, "grok");
    assert.equal(result.value.nodes[0]?.id, "n1");
  });

  it("gemini parses remote optimisation JSON via injected fetch", async () => {
    const copilot = createAiCopilot({
      enabled: true,
      provider: { kind: "gemini", apiKey: "customer-gemini-key" },
      fetch: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '{"hints":[{"code":"OK","message":"fine"}],"rationale":"gemini ok"}',
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const result = await copilot.suggestOptimisations([
      { id: "n1", type: "task", dependsOn: [] },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.provider, "gemini");
    assert.equal(result.value.hints[0]?.code, "OK");
  });
});
