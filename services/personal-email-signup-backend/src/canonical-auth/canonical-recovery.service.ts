import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { UserAccountStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { EmailService } from "../email/email.service";
import { PasswordPolicyService } from "../security/password-policy/password-policy.service";
import { RedisService } from "../redis/redis.service";

const RECOVERY_PURPOSE = "password-reset-v1";
const GENERIC_RESPONSE =
  "If the account is eligible, recovery instructions will be sent.";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class CanonicalRecoveryService {
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

    const record = await this.redis.getAndDelete<{
      purpose: string;
      userId: string;
    }>(this.keyFor(token));
    if (!record || record.purpose !== RECOVERY_PURPOSE) {
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
      throw new UnauthorizedException("Account is not eligible for recovery");
    }

    const policy = await this.passwordPolicy.evaluate(password, {
      userInputs: [user.email, user.username],
      skipHIBP: true,
    });
    if (!policy.compliant || !policy.hash) {
      throw new UnauthorizedException(
        "Password does not meet security requirements",
      );
    }

    await this.prisma.$transaction(async (transaction) => {
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

  private normalizeEmail(value: string): string {
    const email = value.trim().toLowerCase();
    if (!email || !email.includes("@") || email.length > 320) {
      throw new UnauthorizedException("Invalid recovery request");
    }
    return email;
  }
}
