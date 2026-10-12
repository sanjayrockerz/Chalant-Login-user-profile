import { CanonicalPhoneHashingAdapter } from "./canonical-contact-adapters";

describe("CanonicalPhoneHashingAdapter", () => {
  it("uses the legacy format only when explicitly configured as the default", () => {
    const config = {
      get: jest.fn((key: string) =>
        key === "CONTACT_HASH_MODE" ? "sha256-v1" : undefined,
      ),
    };
    const adapter = new CanonicalPhoneHashingAdapter(config as never);

    expect(adapter.hash("+15551234567")).toBe(
      "8a59780bb8cd2ba022bfa5ba2ea3b6e07af17a7d8b30c1f9b3390e36f69019e4",
    );
  });

  it("fails closed when secure hashing is enabled without a key", () => {
    const config = {
      get: jest.fn((key: string) =>
        key === "CONTACT_HASH_MODE" ? "hmac-sha256-v2" : undefined,
      ),
    };

    expect(() => new CanonicalPhoneHashingAdapter(config as never)).toThrow(
      "CONTACT_HMAC_KEY is required",
    );
  });

  it("uses the configured keyed format and does not verify legacy digests", () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === "CONTACT_HASH_MODE") return "hmac-sha256-v2";
        return "contact-hmac-key-that-is-at-least-32-bytes-long";
      }),
    };
    const adapter = new CanonicalPhoneHashingAdapter(config as never);
    const digest = adapter.hash("+15551234567");

    expect(adapter.verify("+15551234567", digest)).toBe(true);
    expect(
      adapter.verify(
        "+15551234567",
        "8a59780bb8cd2ba022bfa5ba2ea3b6e07af17a7d8b30c1f9b3390e36f69019e4",
      ),
    ).toBe(false);
  });
});
