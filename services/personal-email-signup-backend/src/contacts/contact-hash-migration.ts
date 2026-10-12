export type ContactHashMode = "sha256-v1" | "hmac-sha256-v2";

export interface ContactHashTransitionInput {
  currentMode: ContactHashMode;
  targetMode: ContactHashMode;
  originalValuesAvailable: boolean;
  targetKeyConfigured: boolean;
}

export interface ContactHashTransitionPlan {
  allowed: true;
  requiresReindex: boolean;
  legacyMatchingAllowed: false;
  rollback: "restore-source-mode-before-cutover";
}

export function planContactHashTransition(
  input: ContactHashTransitionInput,
): ContactHashTransitionPlan {
  if (input.targetMode === "hmac-sha256-v2" && !input.targetKeyConfigured) {
    throw new Error("A target HMAC key is required before cutover");
  }

  if (
    input.currentMode === "hmac-sha256-v2" &&
    input.targetMode === "sha256-v1"
  ) {
    throw new Error("Contact hash security downgrade is not permitted");
  }

  const requiresReindex = input.currentMode !== input.targetMode;
  if (
    requiresReindex &&
    input.targetMode === "hmac-sha256-v2" &&
    !input.originalValuesAvailable
  ) {
    throw new Error(
      "Original normalized phone values are required for HMAC re-indexing",
    );
  }

  return {
    allowed: true,
    requiresReindex,
    legacyMatchingAllowed: false,
    rollback: "restore-source-mode-before-cutover",
  };
}
