/**
 * RFC-0005 local event triggers. Loopback only. Default disabled.
 */

import { createServer, type Server } from "node:http";
import type { ResolverOutboundEvent } from "./dependencyResolver.js";
import type { TriggerBinding } from "./dagCompiler.js";

export type TriggerAction =
  | { type: "START_WORKFLOW"; workflowId: string }
  | { type: "RESUME_NODE"; workflowId: string; nodeId: string };

export interface TriggerDelivery {
  triggerId: string;
  idempotencyKey: string;
  receivedAt: string;
  payload?: Record<string, unknown>;
}

export interface TriggerListener {
  start(bindings: TriggerBinding[]): void;
  stop(): void;
  handle(delivery: TriggerDelivery): ResolverOutboundEvent[];
}

export interface TriggerHooks {
  startWorkflow(workflowId: string, delivery: TriggerDelivery): ResolverOutboundEvent[];
  resumeNode(workflowId: string, nodeId: string, delivery: TriggerDelivery): ResolverOutboundEvent[];
}

export function createTriggerListener(
  hooks: TriggerHooks,
  bindHost = "127.0.0.1",
): TriggerListener {
  let server: Server | undefined;
  const seen = new Set<string>();
  const enabled = new Map<string, TriggerBinding>();
  const channels = new Map<string, string>();

  const dispatch = (delivery: TriggerDelivery): ResolverOutboundEvent[] => {
    if (seen.has(delivery.idempotencyKey)) {
      return [];
    }
    const binding = enabled.get(delivery.triggerId);
    if (!binding) {
      return [
        {
          type: "RESOLVER_STATE_AMBIGUOUS",
          nodeId: "",
          reason: `unknown or disabled trigger ${delivery.triggerId}`,
        },
      ];
    }
    seen.add(delivery.idempotencyKey);
    if (binding.action.type === "START_WORKFLOW") {
      return hooks.startWorkflow(binding.action.workflowId, delivery);
    }
    return hooks.resumeNode(binding.action.workflowId, binding.action.nodeId, delivery);
  };

  return {
    start(bindings): void {
      for (const b of bindings) {
        if (b.enabled !== true) {
          continue;
        }
        enabled.set(b.id, b);
        if (b.kind === "queue" && b.channel) {
          channels.set(b.channel, b.id);
        }
      }
      const webhooks = [...enabled.values()].filter((b) => b.kind === "webhook");
      if (webhooks.length === 0) {
        return;
      }
      if (bindHost !== "127.0.0.1" && bindHost !== "::1" && bindHost !== "localhost") {
        throw new Error("non-loopback webhook bind refused without explicit later RFC");
      }
      server = createServer((req, res) => {
        const url = req.url ?? "/";
        const match = webhooks.find((w) => w.path === url);
        if (!match) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          let payload: Record<string, unknown> | undefined;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
          } catch {
            payload = undefined;
          }
          const key =
            typeof req.headers["x-idempotency-key"] === "string"
              ? req.headers["x-idempotency-key"]
              : `${match.id}:${Date.now()}`;
          dispatch({
            triggerId: match.id,
            idempotencyKey: key,
            receivedAt: new Date().toISOString(),
            payload,
          });
          res.statusCode = 202;
          res.end("accepted");
        });
      });
      server.listen(0, bindHost);
    },

    stop(): void {
      server?.close();
      server = undefined;
      enabled.clear();
      channels.clear();
    },

    handle(delivery): ResolverOutboundEvent[] {
      return dispatch(delivery);
    },
  };
}

export function publishQueue(
  listener: TriggerListener,
  triggerId: string,
  payload?: Record<string, unknown>,
  idempotencyKey = `q:${triggerId}:${Date.now()}`,
): ResolverOutboundEvent[] {
  return listener.handle({
    triggerId,
    idempotencyKey,
    receivedAt: new Date().toISOString(),
    payload,
  });
}
