/**
 * RFC-0019 Marketplace Launch.
 * Signed packages, partner onboarding, customer-mirrorable registry.
 * No phone-home SaaS registry by default.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type PartnerStatus = "pending" | "approved" | "suspended";

export type PackageKind = "node-type" | "connector" | "template";

export interface Partner {
  partnerId: string;
  displayName: string;
  status: PartnerStatus;
  /** Opaque signing secret held by partner / operator — not logged. */
  signingSecret: string;
}

export interface MarketplacePackage {
  packageId: string;
  name: string;
  version: string;
  kind: PackageKind;
  partnerId: string;
  /** SHA-256 hex of package payload bytes. */
  payloadHash: string;
  /** HMAC-SHA256 hex over canonical manifest. */
  signature: string;
  publishedAt: string;
}

export interface PublishInput {
  partnerId: string;
  name: string;
  version: string;
  kind: PackageKind;
  payload: Uint8Array | string;
  /** Optional deterministic id for tests. */
  packageId?: string;
}

export interface RegistryMirror {
  version: 1;
  partners: Array<Omit<Partner, "signingSecret"> & { signingSecret?: string }>;
  packages: MarketplacePackage[];
}

export type MarketplaceResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "INVALID" | "DENIED" | "NOT_FOUND" | "CONFLICT" | "UNSIGNED" | "BAD_SIGNATURE";
      message: string;
    };

export interface MarketplaceRegistryConfig {
  now?: () => number;
  idFactory?: () => string;
  /**
   * When importing mirrors, require signing secrets to be present
   * for verification. Default true (fail-closed).
   */
  requireSecretsOnImport?: boolean;
}

export interface MarketplaceRegistry {
  onboardPartner(input: {
    partnerId: string;
    displayName: string;
    signingSecret: string;
  }): MarketplaceResult<Partner>;
  approvePartner(partnerId: string): MarketplaceResult<Partner>;
  suspendPartner(partnerId: string): MarketplaceResult<Partner>;
  publish(input: PublishInput): MarketplaceResult<MarketplacePackage>;
  getPackage(packageId: string): MarketplacePackage | undefined;
  listPackages(filter?: { kind?: PackageKind; partnerId?: string }): MarketplacePackage[];
  verify(packageId: string): MarketplaceResult<{ valid: true }>;
  exportMirror(opts?: { includeSecrets?: boolean }): RegistryMirror;
  importMirror(mirror: RegistryMirror): MarketplaceResult<{ partners: number; packages: number }>;
}

function payloadHash(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

function toBytes(payload: Uint8Array | string): Uint8Array {
  return typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
}

function canonicalManifest(p: {
  packageId: string;
  name: string;
  version: string;
  kind: PackageKind;
  partnerId: string;
  payloadHash: string;
}): string {
  return [p.packageId, p.name, p.version, p.kind, p.partnerId, p.payloadHash].join("|");
}

export function signPackageManifest(
  manifest: {
    packageId: string;
    name: string;
    version: string;
    kind: PackageKind;
    partnerId: string;
    payloadHash: string;
  },
  signingSecret: string,
): string {
  return createHmac("sha256", signingSecret).update(canonicalManifest(manifest)).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function createMarketplaceRegistry(
  cfg: MarketplaceRegistryConfig = {},
): MarketplaceRegistry {
  const now = cfg.now ?? (() => Date.now());
  const idFactory =
    cfg.idFactory ??
    (() => `pkg-${Math.random().toString(36).slice(2, 10)}`);
  const requireSecretsOnImport = cfg.requireSecretsOnImport ?? true;

  const partners = new Map<string, Partner>();
  const packages = new Map<string, MarketplacePackage>();

  return {
    onboardPartner(input) {
      const partnerId = input.partnerId?.trim();
      const displayName = input.displayName?.trim();
      if (!partnerId || !displayName || !input.signingSecret) {
        return {
          ok: false,
          code: "INVALID",
          message: "partnerId, displayName, and signingSecret required",
        };
      }
      if (partners.has(partnerId)) {
        return { ok: false, code: "CONFLICT", message: `partner ${partnerId} exists` };
      }
      const partner: Partner = {
        partnerId,
        displayName,
        status: "pending",
        signingSecret: input.signingSecret,
      };
      partners.set(partnerId, partner);
      return { ok: true, value: { ...partner } };
    },

    approvePartner(partnerId) {
      const p = partners.get(partnerId);
      if (!p) return { ok: false, code: "NOT_FOUND", message: `partner ${partnerId} not found` };
      p.status = "approved";
      return { ok: true, value: { ...p } };
    },

    suspendPartner(partnerId) {
      const p = partners.get(partnerId);
      if (!p) return { ok: false, code: "NOT_FOUND", message: `partner ${partnerId} not found` };
      p.status = "suspended";
      return { ok: true, value: { ...p } };
    },

    publish(input) {
      const partner = partners.get(input.partnerId);
      if (!partner) {
        return { ok: false, code: "NOT_FOUND", message: `partner ${input.partnerId} not found` };
      }
      if (partner.status !== "approved") {
        return {
          ok: false,
          code: "DENIED",
          message: `partner ${partner.partnerId} is ${partner.status}`,
        };
      }
      const name = input.name?.trim();
      const version = input.version?.trim();
      if (!name || !version) {
        return { ok: false, code: "INVALID", message: "name and version required" };
      }
      if (!["node-type", "connector", "template"].includes(input.kind)) {
        return { ok: false, code: "INVALID", message: "invalid package kind" };
      }
      const bytes = toBytes(input.payload);
      if (bytes.byteLength === 0) {
        return { ok: false, code: "INVALID", message: "payload required" };
      }
      const packageId = input.packageId?.trim() || idFactory();
      if (packages.has(packageId)) {
        return { ok: false, code: "CONFLICT", message: `package ${packageId} exists` };
      }
      const hash = payloadHash(bytes);
      const manifest = {
        packageId,
        name,
        version,
        kind: input.kind,
        partnerId: partner.partnerId,
        payloadHash: hash,
      };
      const signature = signPackageManifest(manifest, partner.signingSecret);
      if (!signature) {
        return { ok: false, code: "UNSIGNED", message: "failed to sign package" };
      }
      const pkg: MarketplacePackage = {
        ...manifest,
        signature,
        publishedAt: new Date(now()).toISOString(),
      };
      packages.set(packageId, pkg);
      return { ok: true, value: { ...pkg } };
    },

    getPackage(packageId) {
      const p = packages.get(packageId);
      return p ? { ...p } : undefined;
    },

    listPackages(filter) {
      return [...packages.values()]
        .filter((p) => {
          if (filter?.kind && p.kind !== filter.kind) return false;
          if (filter?.partnerId && p.partnerId !== filter.partnerId) return false;
          return true;
        })
        .map((p) => ({ ...p }));
    },

    verify(packageId) {
      const pkg = packages.get(packageId);
      if (!pkg) {
        return { ok: false, code: "NOT_FOUND", message: `package ${packageId} not found` };
      }
      if (!pkg.signature) {
        return { ok: false, code: "UNSIGNED", message: "package missing signature" };
      }
      const partner = partners.get(pkg.partnerId);
      if (!partner?.signingSecret) {
        return {
          ok: false,
          code: "DENIED",
          message: "partner signing secret unavailable for verify",
        };
      }
      const expected = signPackageManifest(
        {
          packageId: pkg.packageId,
          name: pkg.name,
          version: pkg.version,
          kind: pkg.kind,
          partnerId: pkg.partnerId,
          payloadHash: pkg.payloadHash,
        },
        partner.signingSecret,
      );
      if (!safeEqualHex(expected, pkg.signature)) {
        return { ok: false, code: "BAD_SIGNATURE", message: "signature mismatch" };
      }
      return { ok: true, value: { valid: true } };
    },

    exportMirror(opts) {
      const includeSecrets = opts?.includeSecrets ?? false;
      return {
        version: 1,
        partners: [...partners.values()].map((p) => {
          if (includeSecrets) return { ...p };
          const { signingSecret: _, ...rest } = p;
          return rest;
        }),
        packages: [...packages.values()].map((p) => ({ ...p })),
      };
    },

    importMirror(mirror) {
      if (mirror.version !== 1) {
        return { ok: false, code: "INVALID", message: "unsupported mirror version" };
      }
      if (!Array.isArray(mirror.partners) || !Array.isArray(mirror.packages)) {
        return { ok: false, code: "INVALID", message: "malformed mirror" };
      }
      for (const p of mirror.partners) {
        if (!p.partnerId || !p.displayName) {
          return { ok: false, code: "INVALID", message: "partner missing fields" };
        }
        if (requireSecretsOnImport && !p.signingSecret) {
          return {
            ok: false,
            code: "DENIED",
            message: `mirror partner ${p.partnerId} missing signingSecret`,
          };
        }
        partners.set(p.partnerId, {
          partnerId: p.partnerId,
          displayName: p.displayName,
          status: p.status ?? "approved",
          signingSecret: p.signingSecret ?? "",
        });
      }
      for (const pkg of mirror.packages) {
        if (!pkg.packageId || !pkg.signature || !pkg.payloadHash) {
          return { ok: false, code: "UNSIGNED", message: "package in mirror missing signature" };
        }
        packages.set(pkg.packageId, { ...pkg });
      }
      return {
        ok: true,
        value: { partners: mirror.partners.length, packages: mirror.packages.length },
      };
    },
  };
}
