/**
 * RFC-0028 AI Co-Pilot research scaffold.
 * Providers: grok | gemini | local.
 * Defaults DISABLED. Customer-held keys only. No phone-home.
 */

export type CopilotProviderKind = "grok" | "gemini" | "local";

export interface CopilotProviderConfig {
  kind: CopilotProviderKind;
  /**
   * Customer-held API key for grok/gemini.
   * Never logged. Required when enabled and kind !== local.
   */
  apiKey?: string;
  /** Optional customer proxy / regional endpoint. */
  baseUrl?: string;
  /** Optional model override. */
  model?: string;
}

export interface WorkflowNodeSketch {
  id: string;
  type: string;
  dependsOn: string[];
  note?: string;
}

export interface AuthoringSuggestion {
  provider: CopilotProviderKind;
  brief: string;
  nodes: WorkflowNodeSketch[];
  rationale: string;
}

export interface OptimisationHint {
  code: string;
  message: string;
  nodeIds?: string[];
}

export interface OptimisationSuggestion {
  provider: CopilotProviderKind;
  hints: OptimisationHint[];
  rationale: string;
}

export type CopilotResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "DISABLED" | "INVALID" | "DENIED" | "UNAVAILABLE" | "BAD_RESPONSE";
      message: string;
    };

export interface AiCopilotConfig {
  /** Default false — fail-closed, no outbound calls. */
  enabled?: boolean;
  provider: CopilotProviderConfig;
  /** Injected for tests / custom transports. */
  fetch?: typeof fetch;
}

export interface AiCopilot {
  enabled(): boolean;
  providerKind(): CopilotProviderKind;
  /** Draft node sketches from a natural-language brief. */
  suggestWorkflow(brief: string): Promise<CopilotResult<AuthoringSuggestion>>;
  /** Suggest optimisation hints for an existing sketch. */
  suggestOptimisations(
    nodes: WorkflowNodeSketch[],
  ): Promise<CopilotResult<OptimisationSuggestion>>;
}

const DEFAULT_GROK_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GROK_MODEL = "grok-2-latest";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

function localAuthor(brief: string): AuthoringSuggestion {
  const trimmed = brief.trim();
  const tokens = trimmed
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
    .slice(0, 4);
  const nodes: WorkflowNodeSketch[] =
    tokens.length === 0
      ? [{ id: "n1", type: "task", dependsOn: [], note: trimmed || "empty brief" }]
      : tokens.map((t, i) => ({
          id: `n${i + 1}`,
          type: t === "fetch" || t === "http" ? "http.fetch" : "task",
          dependsOn: i === 0 ? [] : [`n${i}`],
          note: `from brief token "${t}"`,
        }));
  return {
    provider: "local",
    brief: trimmed,
    nodes,
    rationale: "local rule-based sketch (offline)",
  };
}

function localOptimise(nodes: WorkflowNodeSketch[]): OptimisationSuggestion {
  const hints: OptimisationHint[] = [];
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    for (const d of n.dependsOn) {
      if (!ids.has(d)) {
        hints.push({
          code: "MISSING_DEP",
          message: `node ${n.id} depends on missing ${d}`,
          nodeIds: [n.id],
        });
      }
    }
  }
  const roots = nodes.filter((n) => n.dependsOn.length === 0);
  if (roots.length > 1) {
    hints.push({
      code: "MULTI_ROOT",
      message: "multiple entrypoints — consider an explicit fan-in",
      nodeIds: roots.map((r) => r.id),
    });
  }
  if (nodes.length >= 3) {
    const parallelizable = nodes.filter(
      (n) =>
        n.dependsOn.length === 1 &&
        nodes.some(
          (o) =>
            o.id !== n.id &&
            o.dependsOn.length === 1 &&
            o.dependsOn[0] === n.dependsOn[0],
        ),
    );
    if (parallelizable.length >= 2) {
      hints.push({
        code: "PARALLEL_BATCH",
        message: "siblings sharing one parent can run in the same batch",
        nodeIds: [...new Set(parallelizable.map((p) => p.id))],
      });
    }
  }
  if (hints.length === 0) {
    hints.push({
      code: "OK",
      message: "no structural issues detected locally",
    });
  }
  return {
    provider: "local",
    hints,
    rationale: "local structural heuristics (offline)",
  };
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

function asAuthoring(
  provider: CopilotProviderKind,
  brief: string,
  raw: unknown,
): AuthoringSuggestion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const nodesRaw = obj.nodes;
  if (!Array.isArray(nodesRaw) || nodesRaw.length === 0) return undefined;
  const nodes: WorkflowNodeSketch[] = [];
  for (const item of nodesRaw) {
    if (!item || typeof item !== "object") return undefined;
    const n = item as Record<string, unknown>;
    if (typeof n.id !== "string" || typeof n.type !== "string") return undefined;
    const dependsOn = Array.isArray(n.dependsOn)
      ? n.dependsOn.filter((d): d is string => typeof d === "string")
      : [];
    nodes.push({
      id: n.id,
      type: n.type,
      dependsOn,
      note: typeof n.note === "string" ? n.note : undefined,
    });
  }
  return {
    provider,
    brief,
    nodes,
    rationale:
      typeof obj.rationale === "string" ? obj.rationale : `${provider} authoring`,
  };
}

function asOptimisation(
  provider: CopilotProviderKind,
  raw: unknown,
): OptimisationSuggestion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const hintsRaw = obj.hints;
  if (!Array.isArray(hintsRaw) || hintsRaw.length === 0) return undefined;
  const hints: OptimisationHint[] = [];
  for (const item of hintsRaw) {
    if (!item || typeof item !== "object") return undefined;
    const h = item as Record<string, unknown>;
    if (typeof h.code !== "string" || typeof h.message !== "string") {
      return undefined;
    }
    hints.push({
      code: h.code,
      message: h.message,
      nodeIds: Array.isArray(h.nodeIds)
        ? h.nodeIds.filter((x): x is string => typeof x === "string")
        : undefined,
    });
  }
  return {
    provider,
    hints,
    rationale:
      typeof obj.rationale === "string"
        ? obj.rationale
        : `${provider} optimisation`,
  };
}

export function createAiCopilot(cfg: AiCopilotConfig): AiCopilot {
  const enabled = cfg.enabled === true;
  const provider = cfg.provider;
  const fetchImpl = cfg.fetch ?? globalThis.fetch?.bind(globalThis);

  async function remoteComplete(
    system: string,
    user: string,
  ): Promise<CopilotResult<string>> {
    if (!enabled) {
      return { ok: false, code: "DISABLED", message: "AI Co-Pilot is disabled" };
    }
    if (provider.kind === "local") {
      return { ok: false, code: "INVALID", message: "local provider has no remote complete" };
    }
    const apiKey = provider.apiKey?.trim();
    if (!apiKey) {
      return {
        ok: false,
        code: "DENIED",
        message: `${provider.kind} requires customer-held apiKey`,
      };
    }
    if (!fetchImpl) {
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "fetch not available",
      };
    }

    try {
      if (provider.kind === "grok") {
        const url = provider.baseUrl?.trim() || DEFAULT_GROK_URL;
        const model = provider.model?.trim() || DEFAULT_GROK_MODEL;
        const res = await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: 0,
          }),
        });
        if (!res.ok) {
          return {
            ok: false,
            code: "UNAVAILABLE",
            message: `grok HTTP ${res.status}`,
          };
        }
        const body = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = body.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
          return {
            ok: false,
            code: "BAD_RESPONSE",
            message: "grok empty content",
          };
        }
        return { ok: true, value: content };
      }

      /** gemini */
      const model = provider.model?.trim() || DEFAULT_GEMINI_MODEL;
      const base =
        provider.baseUrl?.trim() ||
        `${DEFAULT_GEMINI_URL}/${encodeURIComponent(model)}:generateContent`;
      const url = base.includes("?")
        ? `${base}&key=${encodeURIComponent(apiKey)}`
        : `${base}?key=${encodeURIComponent(apiKey)}`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${system}\n\n${user}` }],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      });
      if (!res.ok) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: `gemini HTTP ${res.status}`,
        };
      }
      const body = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const content = body.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof content !== "string" || !content.trim()) {
        return {
          ok: false,
          code: "BAD_RESPONSE",
          message: "gemini empty content",
        };
      }
      return { ok: true, value: content };
    } catch (err) {
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: err instanceof Error ? err.message : "provider call failed",
      };
    }
  }

  return {
    enabled() {
      return enabled;
    },

    providerKind() {
      return provider.kind;
    },

    async suggestWorkflow(brief) {
      if (!enabled) {
        return {
          ok: false,
          code: "DISABLED",
          message: "AI Co-Pilot is disabled",
        };
      }
      const text = brief?.trim();
      if (!text) {
        return { ok: false, code: "INVALID", message: "brief required" };
      }
      if (provider.kind === "local") {
        return { ok: true, value: localAuthor(text) };
      }
      const remote = await remoteComplete(
        'Return ONLY JSON: {"nodes":[{"id":"string","type":"string","dependsOn":["string"],"note":"string"}],"rationale":"string"} for a Smartware DAG sketch.',
        `Brief: ${text}`,
      );
      if (!remote.ok) return remote;
      const parsed = asAuthoring(provider.kind, text, parseJsonObject(remote.value));
      if (!parsed) {
        return {
          ok: false,
          code: "BAD_RESPONSE",
          message: "could not parse authoring JSON",
        };
      }
      return { ok: true, value: parsed };
    },

    async suggestOptimisations(nodes) {
      if (!enabled) {
        return {
          ok: false,
          code: "DISABLED",
          message: "AI Co-Pilot is disabled",
        };
      }
      if (!Array.isArray(nodes) || nodes.length === 0) {
        return {
          ok: false,
          code: "INVALID",
          message: "nodes array required",
        };
      }
      if (provider.kind === "local") {
        return { ok: true, value: localOptimise(nodes) };
      }
      const remote = await remoteComplete(
        'Return ONLY JSON: {"hints":[{"code":"string","message":"string","nodeIds":["string"]}],"rationale":"string"} for DAG optimisation.',
        `Nodes: ${JSON.stringify(nodes)}`,
      );
      if (!remote.ok) return remote;
      const parsed = asOptimisation(provider.kind, parseJsonObject(remote.value));
      if (!parsed) {
        return {
          ok: false,
          code: "BAD_RESPONSE",
          message: "could not parse optimisation JSON",
        };
      }
      return { ok: true, value: parsed };
    },
  };
}
