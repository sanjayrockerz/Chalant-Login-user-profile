import { createHash } from "crypto";
import { UserAccountStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.module";
import { CanonicalAuthService } from "../canonical-auth/canonical-auth.service";
import { SafetyOrderingService } from "./safety-ordering.service";

async function main() {
  const databaseUrl = process.env.SAFETY_ORDERING_DATABASE_URL;
  const operationId = process.env.SAFETY_TEST_OPERATION_ID;
  const targetId = process.env.SAFETY_TEST_TARGET_ID;
  const actorId = process.env.SAFETY_TEST_ACTOR_ID;
  const mode = process.env.SAFETY_TEST_CRASH_MODE;
  if (!databaseUrl || !operationId || !targetId || !actorId || !mode) {
    throw new Error("Crash-worker test inputs are incomplete");
  }
  process.env.DATABASE_URL_AUTH = databaseUrl;
  process.env.DATABASE_URL = databaseUrl;
  const prisma = new PrismaService();
  await prisma.$connect();
  const safety = new SafetyOrderingService(prisma);
  const commandHash = createHash("sha256")
    .update(
      JSON.stringify([
        "auth-account-status-v1",
        operationId,
        targetId.toLowerCase(),
        actorId.toLowerCase(),
        UserAccountStatus.SUSPENDED,
      ]),
    )
    .digest("hex");

  if (mode === "before-commit") {
    await safety.runAccountMutation({
      operationId,
      subjectId: targetId,
      commandHash,
      commit: async (tx) => {
        await tx.user.update({
          where: { id: targetId },
          data: {
            accountStatus: UserAccountStatus.SUSPENDED,
            accountStatusVersion: { increment: 1 },
          },
        });
        process.kill(process.pid, "SIGKILL");
        return undefined;
      },
    });
  } else if (mode === "after-commit") {
    const auth = new CanonicalAuthService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      safety,
    );
    await auth.changeAccountStatus({
      operationId,
      targetId,
      actorId,
      accountStatus: UserAccountStatus.SUSPENDED,
    });
    process.kill(process.pid, "SIGKILL");
  } else {
    throw new Error("Unknown crash-worker mode");
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
