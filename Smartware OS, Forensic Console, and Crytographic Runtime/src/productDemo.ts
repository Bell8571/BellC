/**
 * Product hardening — end-to-end demo wiring:
 * compile → run → place/heal → route → deps → copilot → forensic seal → crypto sign
 * Local only. No phone-home.
 */

import { randomUUID } from "node:crypto";
import { compile, type WorkflowDefinition } from "./dagCompiler.js";
import { createNodeTypeRegistry } from "./pluginApi.js";
import { runWorkflow } from "./runtime.js";
import { createOsBetaPlane } from "./osBeta.js";
import { createOsGaRuntime } from "./osGa.js";
import { createMarketplaceRegistry } from "./marketplace.js";
import { createAiCopilot } from "./aiCopilot.js";
import { createFormalVerifier } from "./formalVerification.js";
import { createForensicConsole, type ForensicConsole } from "./forensicConsole.js";
import {
  createCryptographicRuntime,
  type CryptographicRuntime,
} from "./cryptographicRuntime.js";

export interface ProductDemoReport {
  ok: boolean;
  runId: string;
  workflowId: string;
  steps: Array<{ name: string; ok: boolean; detail: string }>;
  evidenceCount: number;
  chainValid: boolean;
}

export interface ProductDemoOptions {
  definition?: WorkflowDefinition;
  forensic?: ForensicConsole;
  crypto?: CryptographicRuntime;
  now?: () => number;
}

function defaultDefinition(): WorkflowDefinition {
  return {
    id: "demo-linear",
    version: "1.0.0",
    entrypoints: ["a"],
    nodes: {
      a: { id: "a", type: "task", dependsOn: [], config: {} },
      b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
      c: { id: "c", type: "task", dependsOn: ["a"], config: {} },
    },
  };
}

export async function runProductDemo(
  options: ProductDemoOptions = {},
): Promise<ProductDemoReport> {
  const now = options.now ?? (() => Date.now());
  const definition = options.definition ?? defaultDefinition();
  const runId = randomUUID();
  const workflowId = definition.id;
  const steps: ProductDemoReport["steps"] = [];
  const forensic =
    options.forensic ??
    createForensicConsole({ now });
  const crypto =
    options.crypto ??
    createCryptographicRuntime({
      idFactory: () => "demo-hmac",
    });

  const registry = createNodeTypeRegistry();
  registry.registerNodeType({
    type: "task",
    version: "1.0.0",
    configSchema: { fields: {} },
  });

  /** 1. Compile */
  const compiled = compile(definition, registry);
  const compileOk = compiled.ok;
  steps.push({
    name: "compile",
    ok: compileOk,
    detail: compileOk
      ? `batches=${compiled.graph.executionOrder.length}`
      : compiled.errors.map((e) => e.code).join(","),
  });
  forensic.record({
    kind: "compile",
    workflowId,
    runId,
    detail: { ok: compileOk },
  });
  if (!compileOk) {
    return finish(false);
  }

  /** 2. Formal verify DAG batches */
  const verifier = createFormalVerifier({ now });
  const nodes = Object.values(compiled.graph.nodes).map((n) => ({
    id: n.id,
    dependsOn: [...n.dependsOn],
    batchIndex: n.batchIndex,
  }));
  const proof = verifier.verifyDag({ nodes });
  const proofOk = proof.ok && proof.value.ok;
  steps.push({
    name: "formal-verify",
    ok: proofOk,
    detail: proofOk ? "invariants proven" : "invariants violated",
  });

  /** 3. Run workflow */
  forensic.record({ kind: "run_start", workflowId, runId });
  const run = await runWorkflow(definition, registry, {
    jitterSeed: 1,
  });
  const runOk = run.ok && run.terminal === "COMPLETED";
  steps.push({
    name: "run",
    ok: runOk,
    detail: `terminal=${run.terminal}`,
  });
  forensic.record({
    kind: "run_complete",
    workflowId,
    runId,
    detail: { terminal: run.terminal },
  });

  /** 4. OS Beta place/heal */
  const beta = createOsBetaPlane({ healThreshold: 40, now });
  beta.registerSubstrate({
    substrateId: "edge-sick",
    kind: "edge",
    endpoint: "https://edge-sick.local",
    healthy: true,
    healthScore: 20,
  });
  beta.registerSubstrate({
    substrateId: "edge-well",
    kind: "edge",
    endpoint: "https://edge-well.local",
    healthy: true,
    healthScore: 95,
  });
  beta.registerKernel({ kind: "wasm", version: "1.0" });
  const kernel = beta.selectKernel({});
  const heal = beta.healIfNeeded(workflowId, "edge-sick");
  const healOk =
    heal.ok && !("skipped" in heal.value) && heal.value.toSubstrateId === "edge-well";
  steps.push({
    name: "beta-heal",
    ok: healOk && kernel.ok,
    detail: healOk
      ? `migrated→edge-well; kernel=${kernel.ok ? kernel.value.kernel : "?"}`
      : "heal failed",
  });
  forensic.record({
    kind: "heal",
    workflowId,
    runId,
    detail: { ok: healOk },
  });

  /** 5. OS GA route + marketplace deps */
  const market = createMarketplaceRegistry({
    now,
    idFactory: () => "demo-pkg",
  });
  market.onboardPartner({
    partnerId: "demo",
    displayName: "Demo",
    signingSecret: "demo-secret-not-for-prod",
  });
  market.approvePartner("demo");
  market.publish({
    partnerId: "demo",
    name: "task.runtime",
    version: "1.0.0",
    kind: "node-type",
    payload: "demo",
    packageId: "demo-pkg",
  });
  const ga = createOsGaRuntime({ registry: market });
  ga.registerSubstrate({
    substrateId: "cloud-1",
    kind: "cloud",
    endpoint: "https://cloud.local",
    healthy: true,
    latencyMs: 40,
    healthScore: 90,
  });
  ga.registerSubstrate({
    substrateId: "edge-1",
    kind: "edge",
    endpoint: "https://edge.local",
    healthy: true,
    latencyMs: 8,
    healthScore: 88,
  });
  const deps = ga.resolveDependencies([
    { nodeId: "a", packageName: "task.runtime", version: "1.0.0" },
  ]);
  const route = ga.route({ workflowId, nodeId: "a" });
  const gaOk =
    deps.ok && route.ok && route.value.substrateId === "edge-1";
  steps.push({
    name: "ga-route-deps",
    ok: gaOk,
    detail: gaOk
      ? `route=${route.ok ? route.value.substrateId : "?"} deps=verified`
      : "ga step failed",
  });
  forensic.record({
    kind: "route",
    workflowId,
    runId,
    detail: { ok: gaOk },
  });

  /** 6. Co-pilot (local, enabled for demo) */
  const copilot = createAiCopilot({
    enabled: true,
    provider: { kind: "local" },
  });
  const suggestion = await copilot.suggestWorkflow(
    "fetch transform store pipeline",
  );
  const copilotOk = suggestion.ok && suggestion.value.nodes.length > 0;
  steps.push({
    name: "copilot-local",
    ok: copilotOk,
    detail: copilotOk
      ? `nodes=${suggestion.ok ? suggestion.value.nodes.length : 0}`
      : "copilot failed",
  });
  forensic.record({
    kind: "copilot",
    workflowId,
    runId,
    detail: { ok: copilotOk },
  });

  /** 7. Crypto sign the report sketch + forensic seal */
  const imported = crypto.importKey({
    material: "customer-demo-hmac-key",
    algorithm: "hmac-sha256",
    handleId: "demo-hmac",
  });
  const manifest = JSON.stringify({
    workflowId,
    runId,
    steps: steps.map((s) => s.name),
  });
  const signed =
    imported.ok
      ? crypto.sign(imported.value.handleId, manifest)
      : ({ ok: false as const, code: "DENIED" as const, message: "no key" });
  const verify =
    signed.ok ? crypto.verify(signed.value, manifest) : { ok: false as const };
  const cryptoOk = imported.ok && signed.ok && verify.ok;
  steps.push({
    name: "crypto-sign",
    ok: cryptoOk,
    detail: cryptoOk ? "manifest signed+verified" : "crypto failed",
  });
  forensic.record({
    kind: "seal",
    workflowId,
    runId,
    detail: {
      ok: cryptoOk,
      signature: signed.ok ? signed.value.signature.slice(0, 16) : null,
    },
  });

  const chain = forensic.verifyChain();
  const allOk = steps.every((s) => s.ok) && chain.ok;

  return finish(allOk);

  function finish(ok: boolean): ProductDemoReport {
    const chainCheck = forensic.verifyChain();
    return {
      ok,
      runId,
      workflowId,
      steps,
      evidenceCount: forensic.list({ runId }).length,
      chainValid: chainCheck.ok,
    };
  }
}
