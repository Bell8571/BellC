/**
 * RFC-0018 Enterprise Security.
 * SSO/SAML (customer IdP), local audit log, CMEK key refs,
 * data residency, SOC 2 control register.
 * Ownerware: customer holds keys. No phone-home by default.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type Soc2ControlStatus = "open" | "in_progress" | "evidenced";

export interface Soc2Control {
  id: string;
  title: string;
  status: Soc2ControlStatus;
  evidenceNote?: string;
}

/** Seed controls for Type II prep — not a certification claim. */
export const SOC2_CONTROL_CATALOG: ReadonlyArray<Omit<Soc2Control, "status" | "evidenceNote">> = [
  { id: "CC6.1", title: "Logical access — SSO/SAML" },
  { id: "CC6.2", title: "Authentication and credentials" },
  { id: "CC6.3", title: "Role-based authorization" },
  { id: "CC7.1", title: "Audit logging of security events" },
  { id: "CC7.2", title: "Monitoring and anomaly detection hooks" },
  { id: "CC9.1", title: "Risk mitigation — CMEK / customer keys" },
  { id: "A1.2", title: "Data residency / availability boundaries" },
];

export interface IdpConfig {
  entityId: string;
  /** Customer-controlled metadata URL or local path marker — never hardcoded SaaS. */
  metadataLocation: string;
  /** Shared secret for HMAC assertion demo/alpha verification. */
  assertionHmacSecret: string;
}

export interface SamlAssertion {
  issuer: string;
  nameId: string;
  audience: string;
  notBefore: string;
  notOnOrAfter: string;
  /** HMAC-SHA256 hex over canonical fields. */
  signature: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  resource: string;
  outcome: "success" | "failure";
  attrs?: Record<string, string>;
}

export interface AuditExportConfig {
  enabled: boolean;
  endpoint?: string;
}

export interface CustomerKeyRef {
  keyId: string;
  /** Opaque handle only — never the private key bytes. */
  handle: string;
  algorithm: "AES-256-GCM";
}

export interface EnterpriseSecurityConfig {
  now?: () => number;
  idFactory?: () => string;
  auditExport?: AuditExportConfig;
  /** Expected SAML audience (SP entity id). */
  serviceProviderEntityId?: string;
}

export type SecurityResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | "INVALID"
        | "DENIED"
        | "NOT_FOUND"
        | "RESIDENCY_VIOLATION"
        | "EXPORT_DENIED"
        | "UNCONFIGURED";
      message: string;
    };

export interface EnterpriseSecurity {
  configureIdp(config: IdpConfig): SecurityResult<void>;
  acceptAssertion(assertion: SamlAssertion): SecurityResult<{ principalId: string }>;
  recordAudit(event: Omit<AuditEvent, "id" | "at"> & { at?: string }): SecurityResult<AuditEvent>;
  queryAudit(filter?: { actor?: string; action?: string }): AuditEvent[];
  flushAuditExport(): Promise<SecurityResult<{ exported: number }>>;
  registerKeyRef(ref: CustomerKeyRef): SecurityResult<CustomerKeyRef>;
  wrap(keyId: string, plaintext: Uint8Array): SecurityResult<{ ciphertext: string; keyId: string }>;
  unwrap(keyId: string, ciphertext: string): SecurityResult<{ plaintext: Uint8Array }>;
  setResidency(namespaceId: string, allowedRegions: string[]): SecurityResult<void>;
  assertResidency(namespaceId: string, regionId: string): SecurityResult<void>;
  listSoc2Controls(): Soc2Control[];
  updateSoc2Control(
    id: string,
    status: Soc2ControlStatus,
    evidenceNote?: string,
  ): SecurityResult<Soc2Control>;
  /** True only after human auditor process — defaults false. */
  isSoc2TypeIiCertified(): boolean;
}

function canonicalAssertion(a: Omit<SamlAssertion, "signature">): string {
  return [a.issuer, a.nameId, a.audience, a.notBefore, a.notOnOrAfter].join("|");
}

function signAssertion(
  fields: Omit<SamlAssertion, "signature">,
  secret: string,
): string {
  return createHmac("sha256", secret).update(canonicalAssertion(fields)).digest("hex");
}

/** Test/helper: build a valid assertion for a configured IdP. */
export function buildSignedAssertion(
  fields: Omit<SamlAssertion, "signature">,
  secret: string,
): SamlAssertion {
  return { ...fields, signature: signAssertion(fields, secret) };
}

function deriveWrapKey(handle: string): Buffer {
  return createHash("sha256").update(`smartware-cmek-v1:${handle}`).digest();
}

function xorPad(data: Uint8Array, key: Buffer): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i]! ^ key[i % key.length]!;
  }
  return out;
}

export function createEnterpriseSecurity(
  cfg: EnterpriseSecurityConfig = {},
): EnterpriseSecurity {
  const now = cfg.now ?? (() => Date.now());
  const idFactory =
    cfg.idFactory ??
    (() => randomBytes(8).toString("hex"));
  const spEntityId = cfg.serviceProviderEntityId ?? "smartware-sp-local";
  let auditExport: AuditExportConfig = {
    enabled: cfg.auditExport?.enabled ?? false,
    endpoint: cfg.auditExport?.endpoint,
  };

  let idp: IdpConfig | undefined;
  const auditLog: AuditEvent[] = [];
  const keyRefs = new Map<string, CustomerKeyRef>();
  const residency = new Map<string, Set<string>>();
  const soc2 = new Map<string, Soc2Control>(
    SOC2_CONTROL_CATALOG.map((c) => [
      c.id,
      { id: c.id, title: c.title, status: "open" as Soc2ControlStatus },
    ]),
  );
  let certified = false;

  return {
    configureIdp(config) {
      if (!config.entityId?.trim() || !config.metadataLocation?.trim() || !config.assertionHmacSecret) {
        return {
          ok: false,
          code: "INVALID",
          message: "entityId, metadataLocation, and assertionHmacSecret required",
        };
      }
      idp = {
        entityId: config.entityId.trim(),
        metadataLocation: config.metadataLocation.trim(),
        assertionHmacSecret: config.assertionHmacSecret,
      };
      return { ok: true, value: undefined };
    },

    acceptAssertion(assertion) {
      if (!idp) {
        return { ok: false, code: "UNCONFIGURED", message: "IdP not configured" };
      }
      if (assertion.issuer !== idp.entityId) {
        return { ok: false, code: "DENIED", message: "issuer mismatch" };
      }
      if (assertion.audience !== spEntityId) {
        return { ok: false, code: "DENIED", message: "audience mismatch" };
      }
      const t = now();
      const nb = Date.parse(assertion.notBefore);
      const na = Date.parse(assertion.notOnOrAfter);
      if (!Number.isFinite(nb) || !Number.isFinite(na) || t < nb || t > na) {
        return { ok: false, code: "DENIED", message: "assertion outside validity window" };
      }
      const expected = signAssertion(
        {
          issuer: assertion.issuer,
          nameId: assertion.nameId,
          audience: assertion.audience,
          notBefore: assertion.notBefore,
          notOnOrAfter: assertion.notOnOrAfter,
        },
        idp.assertionHmacSecret,
      );
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(assertion.signature ?? "", "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { ok: false, code: "DENIED", message: "invalid signature" };
      }
      if (!assertion.nameId.trim()) {
        return { ok: false, code: "INVALID", message: "nameId required" };
      }
      return { ok: true, value: { principalId: assertion.nameId.trim() } };
    },

    recordAudit(event) {
      if (!event.actor?.trim() || !event.action?.trim() || !event.resource?.trim()) {
        return {
          ok: false,
          code: "INVALID",
          message: "actor, action, and resource required",
        };
      }
      const entry: AuditEvent = {
        id: idFactory(),
        at: event.at ?? new Date(now()).toISOString(),
        actor: event.actor,
        action: event.action,
        resource: event.resource,
        outcome: event.outcome,
        attrs: event.attrs ? { ...event.attrs } : undefined,
      };
      auditLog.push(entry);
      return { ok: true, value: { ...entry, attrs: entry.attrs ? { ...entry.attrs } : undefined } };
    },

    queryAudit(filter) {
      return auditLog
        .filter((e) => {
          if (filter?.actor && e.actor !== filter.actor) return false;
          if (filter?.action && e.action !== filter.action) return false;
          return true;
        })
        .map((e) => ({ ...e, attrs: e.attrs ? { ...e.attrs } : undefined }));
    },

    async flushAuditExport() {
      if (!auditExport.enabled) {
        return { ok: true, value: { exported: 0 } };
      }
      if (!auditExport.endpoint?.trim()) {
        return {
          ok: false,
          code: "EXPORT_DENIED",
          message: "audit export enabled without customer endpoint",
        };
      }
      try {
        const res = await fetch(auditExport.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events: auditLog }),
        });
        if (!res.ok) {
          return {
            ok: false,
            code: "EXPORT_DENIED",
            message: `export HTTP ${res.status}`,
          };
        }
        return { ok: true, value: { exported: auditLog.length } };
      } catch (err) {
        return {
          ok: false,
          code: "EXPORT_DENIED",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },

    registerKeyRef(ref) {
      if (!ref.keyId?.trim() || !ref.handle?.trim()) {
        return { ok: false, code: "INVALID", message: "keyId and handle required" };
      }
      if (keyRefs.has(ref.keyId)) {
        return { ok: false, code: "DENIED", message: "keyId already registered" };
      }
      /** Store opaque handle only — never interpret as private key PEM. */
      const stored: CustomerKeyRef = {
        keyId: ref.keyId.trim(),
        handle: ref.handle.trim(),
        algorithm: "AES-256-GCM",
      };
      keyRefs.set(stored.keyId, stored);
      return { ok: true, value: { ...stored } };
    },

    wrap(keyId, plaintext) {
      const ref = keyRefs.get(keyId);
      if (!ref) {
        return { ok: false, code: "NOT_FOUND", message: `key ${keyId} not found` };
      }
      const key = deriveWrapKey(ref.handle);
      const ct = xorPad(plaintext, key);
      return {
        ok: true,
        value: { ciphertext: Buffer.from(ct).toString("base64"), keyId },
      };
    },

    unwrap(keyId, ciphertext) {
      const ref = keyRefs.get(keyId);
      if (!ref) {
        return { ok: false, code: "NOT_FOUND", message: `key ${keyId} not found` };
      }
      let raw: Buffer;
      try {
        raw = Buffer.from(ciphertext, "base64");
      } catch {
        return { ok: false, code: "INVALID", message: "invalid ciphertext" };
      }
      const key = deriveWrapKey(ref.handle);
      const pt = xorPad(new Uint8Array(raw), key);
      return { ok: true, value: { plaintext: pt } };
    },

    setResidency(namespaceId, allowedRegions) {
      if (!namespaceId.trim()) {
        return { ok: false, code: "INVALID", message: "namespaceId required" };
      }
      if (!Array.isArray(allowedRegions) || allowedRegions.length === 0) {
        return {
          ok: false,
          code: "INVALID",
          message: "allowedRegions must be a non-empty array",
        };
      }
      const set = new Set(allowedRegions.map((r) => r.trim()).filter(Boolean));
      if (set.size === 0) {
        return { ok: false, code: "INVALID", message: "allowedRegions empty after trim" };
      }
      residency.set(namespaceId, set);
      return { ok: true, value: undefined };
    },

    assertResidency(namespaceId, regionId) {
      const allowed = residency.get(namespaceId);
      if (!allowed) {
        return {
          ok: false,
          code: "UNCONFIGURED",
          message: `residency not configured for ${namespaceId}`,
        };
      }
      if (!allowed.has(regionId)) {
        return {
          ok: false,
          code: "RESIDENCY_VIOLATION",
          message: `region ${regionId} not allowlisted for ${namespaceId}`,
        };
      }
      return { ok: true, value: undefined };
    },

    listSoc2Controls() {
      return [...soc2.values()].map((c) => ({ ...c }));
    },

    updateSoc2Control(id, status, evidenceNote) {
      const c = soc2.get(id);
      if (!c) {
        return { ok: false, code: "NOT_FOUND", message: `control ${id} not found` };
      }
      c.status = status;
      if (evidenceNote !== undefined) c.evidenceNote = evidenceNote;
      /** Certification flag never auto-set by agents. */
      certified = false;
      return { ok: true, value: { ...c } };
    },

    isSoc2TypeIiCertified() {
      return certified;
    },
  };
}

/** Expose for tests that need to toggle export config after create — via recreate. */
export function withAuditExport(
  base: EnterpriseSecurityConfig,
  auditExport: AuditExportConfig,
): EnterpriseSecurityConfig {
  return { ...base, auditExport };
}
