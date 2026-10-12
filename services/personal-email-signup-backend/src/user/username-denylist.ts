// Simple reserved names denylist. Governance: update via PR with approval and update the policy doc.
export const RESERVED_USERNAMES = new Set<string>([
  "admin",
  "administrator",
  "support",
  "help",
  "root",
  "system",
  "null",
  "undefined",
  "security",
  "staff",
  "staff-member",
  "postmaster",
  "owner",
  "webmaster",
  "api",
  "billing",
]);

// Governance: to add a name, create a PR updating this file and add an entry to policies/USERNAME_DENYLIST.md
