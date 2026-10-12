import { planContactHashTransition } from "./contact-hash-migration";

describe("contact hash transition policy", () => {
  it("requires original values for legacy to HMAC re-indexing", () => {
    expect(() =>
      planContactHashTransition({
        currentMode: "sha256-v1",
        targetMode: "hmac-sha256-v2",
        originalValuesAvailable: false,
        targetKeyConfigured: true,
      }),
    ).toThrow("Original normalized phone values are required");
  });

  it("allows a secure transition only with key material and re-index inputs", () => {
    expect(
      planContactHashTransition({
        currentMode: "sha256-v1",
        targetMode: "hmac-sha256-v2",
        originalValuesAvailable: true,
        targetKeyConfigured: true,
      }),
    ).toMatchObject({
      allowed: true,
      requiresReindex: true,
      legacyMatchingAllowed: false,
    });
  });

  it("rejects secure-mode downgrade", () => {
    expect(() =>
      planContactHashTransition({
        currentMode: "hmac-sha256-v2",
        targetMode: "sha256-v1",
        originalValuesAvailable: true,
        targetKeyConfigured: true,
      }),
    ).toThrow("downgrade");
  });

  it("requires a key for HMAC key rotation", () => {
    expect(() =>
      planContactHashTransition({
        currentMode: "hmac-sha256-v2",
        targetMode: "hmac-sha256-v2",
        originalValuesAvailable: true,
        targetKeyConfigured: false,
      }),
    ).toThrow("target HMAC key");
  });
});
