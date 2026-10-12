import { createHash } from "crypto";

export function usernameForProvider(
  email: string | undefined,
  subject: string,
): string {
  const local = (email?.split("@", 1)[0] || "provider_user")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  const suffix = createHash("sha256")
    .update(subject)
    .digest("hex")
    .slice(0, 10);
  return `${local.slice(0, 42)}_${suffix}`.slice(0, 55);
}
