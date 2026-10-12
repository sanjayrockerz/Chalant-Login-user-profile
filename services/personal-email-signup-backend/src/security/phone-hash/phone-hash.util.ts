import { createHash, createHmac, timingSafeEqual } from "crypto";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;
const HMAC_MINIMUM_KEY_BYTES = 32;
const HMAC_DOMAIN = "r3-contact-phone-hash:hmac-sha256-v2\0";

function assertE164(phone: string): void {
  if (!E164_REGEX.test(phone)) {
    throw new TypeError("Phone number must be an E.164-formatted string");
  }
}

function assertDigest(digest: string): void {
  if (!SHA256_HEX_REGEX.test(digest)) {
    throw new TypeError(
      "Digest must be a 64-character hexadecimal SHA-256 value",
    );
  }
}

export function assertHmacKey(key: string): void {
  if (Buffer.byteLength(key, "utf8") < HMAC_MINIMUM_KEY_BYTES) {
    throw new TypeError(
      `Contact HMAC key must be at least ${HMAC_MINIMUM_KEY_BYTES} bytes`,
    );
  }
}

function computeDigest(phone: string): string {
  return createHash("sha256").update(phone, "utf8").digest("hex");
}

function computeHmac(phone: string, key: string): string {
  assertHmacKey(key);
  return createHmac("sha256", Buffer.from(key, "utf8"))
    .update(HMAC_DOMAIN, "utf8")
    .update(phone, "utf8")
    .digest("hex");
}

export function hash(phoneE164: string): string {
  assertE164(phoneE164);
  return computeDigest(phoneE164);
}

/**
 * Versioned secure format. Enabling this format requires a deployment-managed
 * secret and a controlled re-upload/re-index because legacy SHA-256 digests
 * cannot be transformed into HMAC digests without the original phone value.
 */
export function hashWithKey(phoneE164: string, key: string): string {
  assertE164(phoneE164);
  return computeHmac(phoneE164, key);
}

export function verify(phoneE164: string, digestHex: string): boolean {
  assertE164(phoneE164);
  assertDigest(digestHex);

  const candidate = computeDigest(phoneE164);
  const candidateBuffer = Buffer.from(candidate, "hex");
  const providedBuffer = Buffer.from(digestHex.toLowerCase(), "hex");

  if (candidateBuffer.length !== providedBuffer.length) {
    return false;
  }

  // timingSafeEqual avoids leaking comparison timing information
  return timingSafeEqual(candidateBuffer, providedBuffer);
}

export function verifyWithKey(
  phoneE164: string,
  digestHex: string,
  key: string,
): boolean {
  assertE164(phoneE164);
  assertDigest(digestHex);

  const candidateBuffer = Buffer.from(computeHmac(phoneE164, key), "hex");
  const providedBuffer = Buffer.from(digestHex.toLowerCase(), "hex");

  return (
    candidateBuffer.length === providedBuffer.length &&
    timingSafeEqual(candidateBuffer, providedBuffer)
  );
}
