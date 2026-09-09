/**
 * RFC-0021 Smartware Cloud GA — Phase 3 surface checklist.
 * Verifies M3.1–M3.7 facades construct and Authority-0 defaults hold.
 * Does NOT clear Phase 3 → OS gate.
 */

import { createControlPlane } from "./controlPlane.js";
import { createInProcessAdapter, createServerlessRuntime } from "./serverlessRuntime.js";
import { startPortal } from "./portal.js";
import { createMultiRegionFabric } from "./multiRegion.js";
import { createEnterpriseSecurity } from "./enterpriseSecurity.js";
import { createMarketplaceRegistry } from "./marketplace.js";
import { createAiScheduler } from "./aiScheduler.js";
import { createBillingEngine } from "./billingEngine.js";

export const PHASE3_GA_VERSION = "3.8.0-phase3" as const;

export type Phase3MilestoneId =
  | "M3.1"
  | "M3.2"
  | "M3.3"
  | "M3.4"
  | "M3.5"
  | "M3.6"
  | "M3.7"
  | "M3.8";

export interface Phase3Check {
  id: Phase3MilestoneId;
  title: string;
  ok: boolean;
  detail: string;
}

export interface Phase3GaReport {
  version: typeof PHASE3_GA_VERSION;
  ok: boolean;
  checks: Phase3Check[];
  /** Always false until human DRI clears Phase 3 → OS. */
  osGateCleared: false;
  ownerwareDefaults: {
    billingMeteringDefaultOff: boolean;
    soc2NotAutoCertified: boolean;
    portalLoopbackDefault: boolean;
  };
}

export async function runPhase3GaChecklist(): Promise<Phase3GaReport> {
  const checks: Phase3Check[] = [];

  // M3.1 Control plane
  {
    const cp = createControlPlane({ idFactory: () => "ga-c1" });
    const created = cp.createCluster({ name: "ga", clusterId: "ga-c1" });
    checks.push({
      id: "M3.1",
      title: "Managed Control Plane",
      ok: created.ok,
      detail: created.ok ? "createCluster ok" : "createCluster failed",
    });
  }

  // M3.2 Serverless
  {
    const rt = createServerlessRuntime({ adapter: createInProcessAdapter() });
    const inv = await rt.invoke({
      workflowId: "ga",
      nodeId: "n1",
      payload: {},
      idempotencyKey: "ga-1",
    });
    checks.push({
      id: "M3.2",
      title: "Serverless Runtime",
      ok: inv.ok && rt.snapshot().meteringEnabled === false,
      detail: inv.ok ? "invoke ok; metering off" : inv.error ?? "invoke failed",
    });
  }

  // M3.3 Portal
  {
    const portal = await startPortal({ host: "127.0.0.1", port: 0 });
    let ok = portal.ok;
    let detail = "portal start";
    if (portal.ok) {
      try {
        const res = await fetch(`${portal.portal.url}api/health`);
        const body = (await res.json()) as { ok?: boolean; localOnly?: boolean };
        ok = Boolean(body.ok && body.localOnly);
        detail = ok ? "loopback health ok" : "health failed";
      } finally {
        await portal.portal.close();
      }
    } else {
      detail = portal.message;
    }
    checks.push({ id: "M3.3", title: "Developer Portal", ok, detail });
  }

  // M3.4 Multi-region
  {
    const fabric = createMultiRegionFabric({ mode: "active-active" });
    fabric.registerRegion({
      regionId: "r1",
      displayName: "R1",
      endpoint: "https://r1.local",
      role: "active",
    });
    const route = fabric.route({ workflowId: "ga" });
    checks.push({
      id: "M3.4",
      title: "Multi-Region Fabric",
      ok: route.ok,
      detail: route.ok ? `routed ${route.value.regionId}` : route.message,
    });
  }

  // M3.5 Enterprise security
  {
    const sec = createEnterpriseSecurity();
    checks.push({
      id: "M3.5",
      title: "Enterprise Security",
      ok: sec.isSoc2TypeIiCertified() === false && sec.listSoc2Controls().length > 0,
      detail: "SOC2 controls present; not auto-certified",
    });
  }

  // M3.6 Marketplace
  {
    const reg = createMarketplaceRegistry({ idFactory: () => "ga-pkg" });
    reg.onboardPartner({
      partnerId: "ga",
      displayName: "GA",
      signingSecret: "ga-secret",
    });
    reg.approvePartner("ga");
    const pub = reg.publish({
      partnerId: "ga",
      name: "ga-node",
      version: "1.0.0",
      kind: "node-type",
      payload: "{}",
    });
    const ver = pub.ok ? reg.verify("ga-pkg") : { ok: false as const };
    checks.push({
      id: "M3.6",
      title: "Marketplace Registry",
      ok: Boolean(pub.ok && ver.ok),
      detail: pub.ok && ver.ok ? "signed package verified" : "publish/verify failed",
    });
  }

  // M3.7 AI + Billing defaults
  {
    const ai = createAiScheduler();
    const billing = createBillingEngine();
    checks.push({
      id: "M3.7",
      title: "AI Scheduler + Billing",
      ok: billing.meteringEnabled() === false && ai.sampleCount() === 0,
      detail: "billing metering default off; AI local-empty ok",
    });
  }

  // M3.8 meta
  {
    const allPrior = checks.every((c) => c.ok);
    checks.push({
      id: "M3.8",
      title: "Smartware Cloud GA Surface",
      ok: allPrior,
      detail: allPrior
        ? "M3.1–M3.7 surface green; OS gate uncleared"
        : "one or more prior checks failed",
    });
  }

  const ok = checks.every((c) => c.ok);
  return {
    version: PHASE3_GA_VERSION,
    ok,
    checks,
    osGateCleared: false,
    ownerwareDefaults: {
      billingMeteringDefaultOff: true,
      soc2NotAutoCertified: true,
      portalLoopbackDefault: true,
    },
  };
}
