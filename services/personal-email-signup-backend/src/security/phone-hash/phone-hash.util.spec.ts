import { hash, hashWithKey, verify, verifyWithKey } from "./phone-hash.util";

describe("phone-hash.util", () => {
  it("hashes E.164 numbers to expected SHA-256 digests", () => {
    const fixtures: Array<{ phone: string; digest: string }> = [
      {
        phone: "+15551234567",
        digest:
          "8a59780bb8cd2ba022bfa5ba2ea3b6e07af17a7d8b30c1f9b3390e36f69019e4",
      },
      {
        phone: "+442071838750",
        digest:
          "e631c2534428c6c9b48c2167604a8983046085e43a2c00ed748733c544c0bb4d",
      },
      {
        phone: "+918527001234",
        digest:
          "bbf19b949548e6ce6f7ff8eb61dbdb05f6b00ec29c70487b95f5d5545738db0e",
      },
    ];

    for (const { phone, digest } of fixtures) {
      expect(hash(phone)).toBe(digest);
    }
  });

  it("rejects non E.164 formatted input", () => {
    const invalidNumbers = [
      "15551234567",
      "+1 (555) 123-4567",
      "++15551234567",
      "+0123",
    ];

    for (const value of invalidNumbers) {
      expect(() => hash(value)).toThrow("E.164");
    }
  });

  it("verifies matching digests", () => {
    const phone = "+15551234567";
    const digest = hash(phone);

    expect(verify(phone, digest)).toBe(true);
  });

  it("fails verification when digest does not match", () => {
    const phone = "+15551234567";
    const digest = hash("+15551230000");

    expect(verify(phone, digest)).toBe(false);
  });

  it("throws for invalid digest inputs", () => {
    const phone = "+15551234567";
    const invalidDigests = ["abc", "zzzz", "123", "".padStart(64, "g")];

    for (const value of invalidDigests) {
      expect(() => verify(phone, value)).toThrow("Digest");
    }
  });

  it("supports deterministic domain-separated HMAC hashing with key separation", () => {
    const phone = "+15551234567";
    const key = "test-contact-hmac-key-that-is-at-least-32-bytes-long";
    const otherKey = "different-contact-hmac-key-that-is-at-least-32-bytes";

    const digest = hashWithKey(phone, key);

    expect(digest).toHaveLength(64);
    expect(digest).toBe(hashWithKey(phone, key));
    expect(digest).not.toBe(hash(phone));
    expect(digest).not.toBe(hashWithKey(phone, otherKey));
    expect(verifyWithKey(phone, digest, key)).toBe(true);
    expect(verifyWithKey(phone, digest, otherKey)).toBe(false);
  });

  it("rejects missing or weak HMAC keys", () => {
    expect(() => hashWithKey("+15551234567", "")).toThrow("at least 32 bytes");
    expect(() => hashWithKey("+15551234567", "too-short")).toThrow(
      "at least 32 bytes",
    );
  });
});
