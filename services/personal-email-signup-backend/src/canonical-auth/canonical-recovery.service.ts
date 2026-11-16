import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "crypto";
import { UserAccountStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { EmailService } from "../email/email.service";
import { PasswordPolicyService } from "../security/password-policy/password-policy.service";
import { RedisService } from "../redis/redis.service";

function isPrismaUniqueConstraintError(
  error: unknown,
): error is { code: "P2002" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

const RECOVERY_PURPOSE = "password-reset-v1";
const GENERIC_RESPONSE =
  "If the account is eligible, recovery instructions will be sent.";
const RECOVERY_CLAIM_TTL_SECONDS = 120;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class CanonicalRecoveryService {
  private readonly logger = new Logger(CanonicalRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  async requestReset(emailAddress: string): Promise<{ message: string }> {
    this.requireEnabled();
    const email = this.normalizeEmail(emailAddress);
    const rate = await this.redis.checkRateLimit(
      `recovery:email:${tokenHash(email)}`,
      this.config.get("RECOVERY_RATE_LIMIT"),
      this.config.get("RECOVERY_RATE_WINDOW_SECONDS"),
    );
    if (!rate.allowed) return { message: GENERIC_RESPONSE };

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        isVerified: true,
        accountStatus: true,
        passwordCredential: { select: { userId: true } },
      },
    });

    // Provider-only accounts and unverified accounts receive the same response
    // as unknown accounts and never receive a password reset credential.
    if (
      !user ||
      !user.isVerified ||
      user.accountStatus !== UserAccountStatus.ACTIVE ||
      !user.passwordCredential
    ) {
      return { message: GENERIC_RESPONSE };
    }

    const rawToken = randomBytes(32).toString("base64url");
    const key = this.keyFor(rawToken);
    await this.redis.set(
      key,
      { purpose: RECOVERY_PURPOSE, userId: user.id },
      this.config.get("RECOVERY_TOKEN_TTL_SECONDS"),
    );

    try {
      const delivery = await this.email.sendPasswordReset(user.email, rawToken);
      if (!delivery.accepted)
        throw new Error("Email provider rejected reset delivery");
    } catch (error) {
      await this.redis.del(key);
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        "Recovery delivery is unavailable",
        {
          cause: error,
        },
      );
    }

    return { message: GENERIC_RESPONSE };
  }

  async resetPassword(token: string, password: string): Promise<void> {
    this.requireEnabled();
    if (!token || !password)
      throw new UnauthorizedException("Invalid recovery credential");

    const key = this.keyFor(token);
    // Reserve without consuming: a failed database transaction must leave the
    // token retryable. SET NX makes concurrent attempts serialize across Auth
    // instances sharing Redis; the lease expires after process failure.
    const claimOwner = randomUUID();
    const claimKey = `${key}:claim`;
    let claimed: string | null;
    try {
      claimed = await this.redis
        .getClient()
        .set(claimKey, claimOwner, "EX", RECOVERY_CLAIM_TTL_SECONDS, "NX");
    } catch {
      throw new ServiceUnavailableException(
        "Recovery credential reservation is unavailable",
      );
    }
    if (claimed !== "OK") {
      throw new UnauthorizedException("Invalid or expired recovery credential");
    }

    let record: { purpose: string; userId: string } | null;
    try {
      record = await this.redis.get<{ purpose: string; userId: string }>(key);
    } catch {
      await this.releaseClaim(claimKey, claimOwner);
      throw new ServiceUnavailableException(
        "Recovery credential storage is unavailable",
      );
    }
    if (!record || record.purpose !== RECOVERY_PURPOSE) {
      await this.releaseClaim(claimKey, claimOwner);
      throw new UnauthorizedException("Invalid or expired recovery credential");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: {
        id: true,
        email: true,
        username: true,
        isVerified: true,
        accountStatus: true,
      },
    });
    if (
      !user ||
      !user.isVerified ||
      user.accountStatus !== UserAccountStatus.ACTIVE
    ) {
      await this.releaseClaim(claimKey, claimOwner);
      throw new UnauthorizedException("Account is not eligible for recovery");
    }

    const policy = await this.passwordPolicy.evaluate(password, {
      userInputs: [user.email, user.username],
      skipHIBP: true,
    });
    if (!policy.compliant || !policy.hash) {
      await this.releaseClaim(claimKey, claimOwner);
      throw new UnauthorizedException(
        "Password does not meet security requirements",
      );
    }

    let tokenConsumed = false;
    try {
      await this.prisma.$transaction(async (transaction) => {
        // The unique digest is the durable source of truth. Redis claims reduce
        // contention, while this row prevents replay after a process crash
        // between database commit and Redis cleanup.
        await transaction.passwordRecoveryConsumption.create({
          data: { tokenHash: tokenHash(token) },
        });
        await transaction.user.update({
          where: { id: user.id },
          data: {
            password: policy.hash,
            passwordCredential: {
              upsert: {
                create: { passwordHash: policy.hash },
                update: { passwordHash: policy.hash },
              },
            },
          },
        });
        await transaction.identitySession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
      tokenConsumed = true;
      try {
        await this.redis.del(key);
      } catch (error) {
        // The transaction already committed the durable replay marker. Cache
        // cleanup failure must not turn a completed password reset into an
        // ambiguous API error or make the token reusable.
        this.logger.error(
          "Recovery token cache cleanup failed after database commit; durable replay marker remains authoritative",
          error instanceof Error ? error.stack : undefined,
        );
      }
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new UnauthorizedException(
          "Invalid or expired recovery credential",
        );
      }
      throw error;
    } finally {
      // If storage failed after the DB commit, retain the claim lease rather
      // than immediately making a possibly consumed credential reusable.
      if (!tokenConsumed) await this.releaseClaim(claimKey, claimOwner);
    }
    await this.releaseClaim(claimKey, claimOwner);
  }

  private requireEnabled(): void {
    if (!this.config.get("CANONICAL_RECOVERY_ENABLED")) {
      throw new ServiceUnavailableException(
        "Canonical recovery is not enabled",
      );
    }
  }

  private keyFor(token: string): string {
    return `canonical-recovery:${RECOVERY_PURPOSE}:${tokenHash(token)}`;
  }

  private async releaseClaim(key: string, owner: string): Promise<void> {
    await this.redis
      .getClient()
      .eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        1,
        key,
        owner,
      );
  }

  private normalizeEmail(value: string): string {
    const email = value.trim().toLowerCase();
    if (!email || !email.includes("@") || email.length > 320) {
      throw new UnauthorizedException("Invalid recovery request");
    }
    return email;
  }
}
