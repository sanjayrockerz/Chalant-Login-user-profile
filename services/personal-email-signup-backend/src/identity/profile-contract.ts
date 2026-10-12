import { CanonicalUserId } from "./identity.types";

/**
 * Internal seam for profile modules. Profile data stays outside identity;
 * only the canonical subject crosses this boundary.
 */
export interface CanonicalProfileReference {
  readonly userId: CanonicalUserId;
}

export interface ProfileOwnershipContract {
  readonly identityOwns: readonly [
    "canonical user ID",
    "account status",
    "authentication identities",
  ];
  readonly profileOwns: readonly [
    "username",
    "display profile",
    "preferences",
    "policy presentation",
  ];
}
