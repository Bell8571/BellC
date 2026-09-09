/**
 * RFC-0030 Cryptographic Runtime.
 * Customer-held keys. Sign/verify + opaque wrap. No phone-home KMS.
 */

import { createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from "node:crypto";

export interface KeyHandle {
  /** Opaque handle — not the raw key. */
  handleId: string;
  algorithm: "hmac-sha256" | "aes-256-gcm";
}

export interface SignedBlob {
  payloadHash: string;
  signature: string;
  handleId: string;
}

export interface WrappedSecret {
  handleId: string;
  ciphertext: string;
  iv: string;
  tag: string;
}

export type CryptoResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "INVALID" | "DENIED" | "NOT_FOUND" | "BAD_SIGNATURE" | "CONFLICT";
      message: string;
    };

export interface CryptographicRuntimeConfig {
  idFactory?: () => string;
}

export interface CryptographicRuntime {
  /**
   * Import customer key material under an opaque handle.
   * Raw key is never returned again from the API.
   */
  importKey(input: {
    material: string | Uint8Array;
    algorithm: KeyHandle["algorithm"];
    handleId?: string;
  }): CryptoResult<KeyHandle>;
  listHandles(): KeyHandle[];
  sign(handleId: string, payload: string | Uint8Array): CryptoResult<SignedBlob>;
  verify(signed: SignedBlob, payload: string | Uint8Array): CryptoResult<{ valid: true }>;
  wrap(handleId: string, plaintext: string | Uint8Array): CryptoResult<WrappedSecret>;
  unwrap(wrapped: WrappedSecret): CryptoResult<{ plaintext: Uint8Array }>;
}

function toBytes(payload: string | Uint8Array): Uint8Array {
  return typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function deriveAesKey(material: Buffer): Buffer {
  return createHash("sha256").update(material).digest();
}

export function createCryptographicRuntime(
  cfg: CryptographicRuntimeConfig = {},
): CryptographicRuntime {
  const idFactory = cfg.idFactory ?? (() => randomBytes(8).toString("hex"));
  const keys = new Map<
    string,
    { algorithm: KeyHandle["algorithm"]; material: Buffer }
  >();

  return {
    importKey(input) {
      if (!input.algorithm) {
        return { ok: false, code: "INVALID", message: "algorithm required" };
      }
      const material = Buffer.from(toBytes(input.material));
      if (material.length === 0) {
        return { ok: false, code: "INVALID", message: "material required" };
      }
      const handleId = (input.handleId?.trim() || idFactory()).trim();
      if (!handleId) {
        return { ok: false, code: "INVALID", message: "handleId required" };
      }
      if (keys.has(handleId)) {
        return {
          ok: false,
          code: "CONFLICT",
          message: `handle ${handleId} exists`,
        };
      }
      keys.set(handleId, { algorithm: input.algorithm, material });
      return { ok: true, value: { handleId, algorithm: input.algorithm } };
    },

    listHandles() {
      return [...keys.entries()].map(([handleId, v]) => ({
        handleId,
        algorithm: v.algorithm,
      }));
    },

    sign(handleId, payload) {
      const key = keys.get(handleId);
      if (!key) {
        return { ok: false, code: "NOT_FOUND", message: `handle ${handleId} not found` };
      }
      if (key.algorithm !== "hmac-sha256") {
        return {
          ok: false,
          code: "DENIED",
          message: "sign requires hmac-sha256 handle",
        };
      }
      const bytes = toBytes(payload);
      const payloadHash = createHash("sha256").update(bytes).digest("hex");
      const signature = createHmac("sha256", key.material)
        .update(bytes)
        .digest("hex");
      return { ok: true, value: { payloadHash, signature, handleId } };
    },

    verify(signed, payload) {
      const key = keys.get(signed.handleId);
      if (!key) {
        return {
          ok: false,
          code: "NOT_FOUND",
          message: `handle ${signed.handleId} not found`,
        };
      }
      if (key.algorithm !== "hmac-sha256") {
        return {
          ok: false,
          code: "DENIED",
          message: "verify requires hmac-sha256 handle",
        };
      }
      const bytes = toBytes(payload);
      const payloadHash = createHash("sha256").update(bytes).digest("hex");
      if (!safeEqualHex(payloadHash, signed.payloadHash)) {
        return {
          ok: false,
          code: "BAD_SIGNATURE",
          message: "payload hash mismatch",
        };
      }
      const expected = createHmac("sha256", key.material)
        .update(bytes)
        .digest("hex");
      if (!safeEqualHex(expected, signed.signature)) {
        return { ok: false, code: "BAD_SIGNATURE", message: "signature mismatch" };
      }
      return { ok: true, value: { valid: true } };
    },

    wrap(handleId, plaintext) {
      const key = keys.get(handleId);
      if (!key) {
        return { ok: false, code: "NOT_FOUND", message: `handle ${handleId} not found` };
      }
      if (key.algorithm !== "aes-256-gcm") {
        return {
          ok: false,
          code: "DENIED",
          message: "wrap requires aes-256-gcm handle",
        };
      }
      const aesKey = deriveAesKey(key.material);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
      const pt = Buffer.from(toBytes(plaintext));
      const enc = Buffer.concat([cipher.update(pt), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        ok: true,
        value: {
          handleId,
          ciphertext: enc.toString("hex"),
          iv: iv.toString("hex"),
          tag: tag.toString("hex"),
        },
      };
    },

    unwrap(wrapped) {
      const key = keys.get(wrapped.handleId);
      if (!key) {
        return {
          ok: false,
          code: "NOT_FOUND",
          message: `handle ${wrapped.handleId} not found`,
        };
      }
      if (key.algorithm !== "aes-256-gcm") {
        return {
          ok: false,
          code: "DENIED",
          message: "unwrap requires aes-256-gcm handle",
        };
      }
      try {
        const aesKey = deriveAesKey(key.material);
        const decipher = createDecipheriv(
          "aes-256-gcm",
          aesKey,
          Buffer.from(wrapped.iv, "hex"),
        );
        decipher.setAuthTag(Buffer.from(wrapped.tag, "hex"));
        const pt = Buffer.concat([
          decipher.update(Buffer.from(wrapped.ciphertext, "hex")),
          decipher.final(),
        ]);
        return { ok: true, value: { plaintext: new Uint8Array(pt) } };
      } catch {
        return {
          ok: false,
          code: "BAD_SIGNATURE",
          message: "unwrap failed (auth tag or ciphertext)",
        };
      }
    },
  };
}
