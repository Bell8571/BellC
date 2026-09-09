/**
 * RFC-0006 Plugin API v1 — in-process node type registry.
 * No network. No telemetry. Duplicate identical register is a no-op.
 */

export type ConfigFieldType = "string" | "number" | "boolean" | "object";

export interface ConfigFieldSchema {
  type: ConfigFieldType;
  required: boolean;
}

export interface NodeConfigSchema {
  fields: Record<string, ConfigFieldSchema>;
}

export interface NodeTypeRegistration {
  type: string;
  version: string;
  configSchema: NodeConfigSchema;
}

export type RegisterResult =
  | { ok: true }
  | { ok: false; code: "DUPLICATE_TYPE"; type: string; message: string }
  | { ok: false; code: "INVALID_REGISTRATION"; message: string };

export interface NodeTypeRegistry {
  registerNodeType(registration: NodeTypeRegistration): RegisterResult;
  getNodeType(type: string): NodeTypeRegistration | undefined;
  listNodeTypes(): NodeTypeRegistration[];
}

function cloneRegistration(reg: NodeTypeRegistration): NodeTypeRegistration {
  const fields: Record<string, ConfigFieldSchema> = {};
  for (const [key, schema] of Object.entries(reg.configSchema.fields)) {
    fields[key] = { type: schema.type, required: schema.required };
  }
  return {
    type: reg.type,
    version: reg.version,
    configSchema: { fields },
  };
}

function registrationsEqual(a: NodeTypeRegistration, b: NodeTypeRegistration): boolean {
  if (a.type !== b.type || a.version !== b.version) {
    return false;
  }
  const aKeys = Object.keys(a.configSchema.fields).sort();
  const bKeys = Object.keys(b.configSchema.fields).sort();
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i];
    if (key !== bKeys[i]) {
      return false;
    }
    if (key === undefined) {
      return false;
    }
    const fa = a.configSchema.fields[key];
    const fb = b.configSchema.fields[key];
    if (!fa || !fb || fa.type !== fb.type || fa.required !== fb.required) {
      return false;
    }
  }
  return true;
}

export function createNodeTypeRegistry(): NodeTypeRegistry {
  const byType = new Map<string, NodeTypeRegistration>();

  return {
    registerNodeType(registration: NodeTypeRegistration): RegisterResult {
      if (registration.type.trim() === "") {
        return { ok: false, code: "INVALID_REGISTRATION", message: "type must be non-empty" };
      }
      if (registration.version.trim() === "") {
        return { ok: false, code: "INVALID_REGISTRATION", message: "version must be non-empty" };
      }
      const existing = byType.get(registration.type);
      if (existing) {
        if (registrationsEqual(existing, registration)) {
          return { ok: true };
        }
        return {
          ok: false,
          code: "DUPLICATE_TYPE",
          type: registration.type,
          message: `type '${registration.type}' is already registered with a different schema or version`,
        };
      }
      byType.set(registration.type, cloneRegistration(registration));
      return { ok: true };
    },

    getNodeType(type: string): NodeTypeRegistration | undefined {
      const found = byType.get(type);
      return found ? cloneRegistration(found) : undefined;
    },

    listNodeTypes(): NodeTypeRegistration[] {
      return [...byType.values()]
        .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
        .map(cloneRegistration);
    },
  };
}
