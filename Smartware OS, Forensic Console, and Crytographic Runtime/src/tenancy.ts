/**
 * RFC-0012 Multi-tenancy — namespaces, quotas, versioned RBAC.
 * Deny-by-default. No external IdP required for alpha.
 */

export const RBAC_SCHEMA_VERSION = "1" as const;

export type Permission =
  | "workflow:read"
  | "workflow:run"
  | "namespace:manage"
  | "cluster:admin";

export type RoleName = "viewer" | "operator" | "admin";

export interface NamespaceQuotas {
  maxConcurrentWorkflows: number;
  maxPlacedNodes: number;
}

export interface Namespace {
  id: string;
  quotas: NamespaceQuotas;
}

export interface RoleBinding {
  principalId: string;
  namespaceId: string;
  role: RoleName;
}

const ROLE_PERMISSIONS: Record<RoleName, ReadonlySet<Permission>> = {
  viewer: new Set(["workflow:read"]),
  operator: new Set(["workflow:read", "workflow:run"]),
  admin: new Set(["workflow:read", "workflow:run", "namespace:manage", "cluster:admin"]),
};

export type AuthzResult =
  | { ok: true }
  | { ok: false; code: "DENIED" | "UNKNOWN_NAMESPACE" | "QUOTA_EXCEEDED"; message: string };

export interface TenancyController {
  rbacSchemaVersion(): typeof RBAC_SCHEMA_VERSION;
  createNamespace(id: string, quotas: NamespaceQuotas): AuthzResult;
  getNamespace(id: string): Namespace | undefined;
  bindRole(binding: RoleBinding): AuthzResult;
  authorize(principalId: string, namespaceId: string, permission: Permission): AuthzResult;
  /** Track a started workflow; fail-closed on quota. */
  beginWorkflow(namespaceId: string, workflowId: string, placedNodeCount: number): AuthzResult;
  endWorkflow(namespaceId: string, workflowId: string): void;
  activeWorkflowCount(namespaceId: string): number;
}

export function createTenancyController(): TenancyController {
  const namespaces = new Map<string, Namespace>();
  const bindings = new Map<string, RoleBinding[]>(); // key: `${principal}|${ns}`
  const active = new Map<string, Map<string, number>>(); // ns -> workflowId -> placed nodes

  const bindingKey = (principalId: string, namespaceId: string): string =>
    `${principalId}\0${namespaceId}`;

  return {
    rbacSchemaVersion: () => RBAC_SCHEMA_VERSION,

    createNamespace(id, quotas) {
      if (!id.trim()) {
        return { ok: false, code: "DENIED", message: "namespace id required" };
      }
      if (quotas.maxConcurrentWorkflows < 0 || quotas.maxPlacedNodes < 0) {
        return { ok: false, code: "DENIED", message: "quotas must be non-negative" };
      }
      if (namespaces.has(id)) {
        return { ok: false, code: "DENIED", message: "namespace already exists" };
      }
      namespaces.set(id, { id, quotas: { ...quotas } });
      active.set(id, new Map());
      return { ok: true };
    },

    getNamespace(id) {
      const ns = namespaces.get(id);
      return ns ? { id: ns.id, quotas: { ...ns.quotas } } : undefined;
    },

    bindRole(binding) {
      if (!namespaces.has(binding.namespaceId)) {
        return { ok: false, code: "UNKNOWN_NAMESPACE", message: "namespace not found" };
      }
      const key = bindingKey(binding.principalId, binding.namespaceId);
      const byRole = new Map((bindings.get(key) ?? []).map((b) => [b.role, b]));
      byRole.set(binding.role, { ...binding });
      bindings.set(key, [...byRole.values()]);
      return { ok: true };
    },

    authorize(principalId, namespaceId, permission) {
      if (!namespaces.has(namespaceId)) {
        return { ok: false, code: "UNKNOWN_NAMESPACE", message: "namespace not found" };
      }
      const list = bindings.get(bindingKey(principalId, namespaceId)) ?? [];
      for (const b of list) {
        if (ROLE_PERMISSIONS[b.role].has(permission)) {
          return { ok: true };
        }
      }
      return { ok: false, code: "DENIED", message: `permission ${permission} denied` };
    },

    beginWorkflow(namespaceId, workflowId, placedNodeCount) {
      const ns = namespaces.get(namespaceId);
      if (!ns) {
        return { ok: false, code: "UNKNOWN_NAMESPACE", message: "namespace not found" };
      }
      const running = active.get(namespaceId)!;
      if (running.has(workflowId)) {
        return { ok: true }; // idempotent begin
      }
      if (running.size >= ns.quotas.maxConcurrentWorkflows) {
        return {
          ok: false,
          code: "QUOTA_EXCEEDED",
          message: `maxConcurrentWorkflows ${ns.quotas.maxConcurrentWorkflows} exceeded`,
        };
      }
      let placed = 0;
      for (const n of running.values()) placed += n;
      if (placed + placedNodeCount > ns.quotas.maxPlacedNodes) {
        return {
          ok: false,
          code: "QUOTA_EXCEEDED",
          message: `maxPlacedNodes ${ns.quotas.maxPlacedNodes} exceeded`,
        };
      }
      running.set(workflowId, placedNodeCount);
      return { ok: true };
    },

    endWorkflow(namespaceId, workflowId) {
      active.get(namespaceId)?.delete(workflowId);
    },

    activeWorkflowCount(namespaceId) {
      return active.get(namespaceId)?.size ?? 0;
    },
  };
}
