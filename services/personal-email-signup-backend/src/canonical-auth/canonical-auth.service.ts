import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, UserAccountStatus } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "crypto";
import { verify as verifyArgon2 } from "@node-rs/argon2";
import { compare as compareBcrypt } from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { EmailService } from "../email/email.service";
import { RedisService } from "../redis/redis.service";
import { SafetyOrderingService } from "../safety-ordering/safety-ordering.service";
import { PasswordPolicyService } from "../security/password-policy/password-policy.service";
import { toCanonicalUserId } from "../identity/identity.types";
import { CanonicalPrincipal } from "../identity/identity.types";
import {
  AuthenticatedResponse,
  AuthenticatedSessionContext,
  PasswordLoginInput,
  RegisterPasswordInput,
  SessionTokens,
} from "./canonical-auth.types";
import {
  persistAccountStatusChangedEvent,
  persistSessionRevokedEvent,
} from "./auth-lifecycle-event";

const ACCESS_TOKEN_TYPE = "canonical-access";
const ISSUER = "r3-canonical-identity";
const AUDIENCE = "r3-api";
const CHAT_ACCESS_TOKEN_TYPE = "chat-access";
const CHAT_AUDIENCE = "chat-backend";
const CHAT_ACCESS_TTL_SECONDS = 300;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCESS_TTL_SECONDS = 15 * 60;
const verifyArgon2Hash = verifyArgon2 as unknown as (
  hash: string,
  password: string,
) => Promise<boolean>;
const compareBcryptHash = compareBcrypt as unknown as (
  password: string,
  hash: string,
) => Promise<boolean>;

function hashRefreshToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

@Injectable()
export class CanonicalAuthService {
  private readonly logger = new Logger(CanonicalAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly email: EmailService,
    private readonly redis: RedisService,
    @Optional() private readonly safetyOrdering?: SafetyOrderingService,
  ) {}

  async getAccountStatusForChat(authUserId: string): Promise<{
    authUserId: string;
    accountStatus: UserAccountStatus;
    version: number;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: authUserId },
      select: { id: true, accountStatus: true, accountStatusVersion: true },
    });
    if (!user) throw new NotFoundException("Account not found");
    return {
      authUserId: user.id,
      accountStatus: user.accountStatus,
      version: user.accountStatusVersion,
    };
  }

  async changeAccountStatus(input: {
    operationId: string;
    targetId: string;
    actorId: string;
    accountStatus: UserAccountStatus;
  }): Promise<{
    authUserId: string;
    accountStatus: UserAccountStatus;
    version: number;
    changed: boolean;
  }> {
    if (!Object.values(UserAccountStatus).includes(input.accountStatus)) {
      throw new BadRequestException("Unsupported account status");
    }

    if (!this.safetyOrdering) {
      throw new ServiceUnavailableException(
        "Account lifecycle ordering is unavailable",
      );
    }
    const commandHash = createHash("sha256")
      .update(
        JSON.stringify([
          "auth-account-status-v1",
          input.operationId,
          input.targetId.toLowerCase(),
          input.actorId.toLowerCase(),
          input.accountStatus,
        ]),
      )
      .digest("hex");

    return this.safetyOrdering.runAccountMutation({
      operationId: input.operationId,
      subjectId: input.targetId,
      commandHash,
      commit: async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: input.targetId },
          select: { id: true, accountStatus: true, accountStatusVersion: true },
        });
        if (!current) throw new NotFoundException("Account not found");
        if (current.accountStatus === input.accountStatus) {
          return {
            authUserId: current.id,
            accountStatus: current.accountStatus,
            version: current.accountStatusVersion,
            changed: false,
          };
        }

        const version = current.accountStatusVersion + 1;
        const changed = await transaction.user.updateMany({
          where: {
            id: current.id,
            accountStatusVersion: current.accountStatusVersion,
          },
          data: {
            accountStatus: input.accountStatus,
            accountStatusVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException("Account status changed concurrently");
        }

        await transaction.accountStatusAudit.create({
          data: {
            targetUserId: current.id,
            actorUserId: input.actorId,
            fromStatus: current.accountStatus,
            toStatus: input.accountStatus,
            version,
          },
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: "chat.account.lifecycle.v1",
            aggregateId: current.id,
            payload: {
              authUserId: current.id,
              accountStatus: input.accountStatus,
              version,
            },
          },
        });
        await persistAccountStatusChangedEvent(
          transaction,
          current.id,
          input.accountStatus,
          version,
          new Date(),
        );

        return {
          authUserId: current.id,
          accountStatus: input.accountStatus,
          version,
          changed: true,
        };
      },
    });
  }

  async register(
    input: RegisterPasswordInput,
  ): Promise<{ status: string; user: CanonicalPrincipal }> {
    const email = this.requireEmail(input.email);
    const username = this.requireText(input.username, "username");
    const password = this.requireText(input.password, "password");
    const policy = await this.passwordPolicy.evaluate(password, {
      userInputs: [email, username],
      skipHIBP: true,
    });
    if (!policy.compliant || !policy.hash) {
      throw new BadRequestException({
        error: "password_policy_violation",
        violations: policy.violations,
      });
    }
    const passwordHash = policy.hash;

    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            email,
            username,
            password: passwordHash,
            isVerified: false,
            accountStatus: UserAccountStatus.ACTIVE,
            passwordCredential: { create: { passwordHash } },
          },
          select: this.userSelect,
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: "chat.profile.provision.v1",
            aggregateId: created.id,
            payload: { authUserId: created.id },
          },
        });
        return created;
      });
      const verificationToken = randomBytes(32).toString("base64url");
      await this.redis.set(
        this.emailVerificationKey(verificationToken),
        user.id,
        this.config.get("EMAIL_VERIFICATION_TOKEN_TTL_SECONDS"),
      );
      if (this.config.get("EMAIL_DELIVERY_ENABLED")) {
        await this.email.sendVerificationEmail(email, verificationToken);
      }

      return {
        status: "verification_required",
        user: this.toPrincipal(user),
      };
    } catch (error: unknown) {
      if (isUniqueError(error))
        throw new ConflictException("Account identity already exists");
      throw error;
    }
  }

  async login(input: PasswordLoginInput): Promise<AuthenticatedResponse> {
    const email = this.requireEmail(input.email);
    const password = this.requireText(input.password, "password");
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        ...this.userSelect,
        password: true,
        passwordCredential: { select: { passwordHash: true } },
      },
    });
    if (
      !user ||
      !(await this.verifyPassword(
        password,
        user.passwordCredential?.passwordHash ?? user.password,
      ))
    ) {
      throw new UnauthorizedException("Invalid credentials");
    }
    if (user.accountStatus !== UserAccountStatus.ACTIVE) {
      throw new UnauthorizedException("Invalid credentials");
    }
    if (!user.isVerified) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const principal = this.toPrincipal(user);
    const tokens = await this.issueSession(principal);
    return { ...tokens, user: principal };
  }

  async verifyEmail(token: string) {
    const raw = this.requireText(token, "token");
    const key = this.emailVerificationKey(raw);
    const userId = await this.redis.get<string>(key);
    if (!userId)
      throw new UnauthorizedException("Invalid email verification token");

    const subject = toCanonicalUserId(userId);
    const user = await this.runAccountSafetyMutation(
      subject,
      "email-verification",
      createHash("sha256").update(raw).digest("hex"),
      async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: subject },
          select: { id: true, isVerified: true },
        });
        if (!current) throw new NotFoundException("Account not found");
        if (!current.isVerified) {
          await transaction.user.update({
            where: { id: subject },
            data: { isVerified: true },
          });
        }
        return transaction.user.findUniqueOrThrow({
          where: { id: subject },
          select: this.userSelect,
        });
      },
    );
    await this.redis.del(key);
    return { status: "verified", user: this.toPrincipal(user) };
  }

  async refresh(refreshToken: string): Promise<AuthenticatedResponse> {
    const raw = this.requireText(refreshToken, "refreshToken");
    const tokenHash = hashRefreshToken(raw);
    const now = new Date();
    const session = await this.prisma.identitySession.findUnique({
      where: { sessionHash: tokenHash },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // Keep the Auth session identity stable while rotating its refresh secret.
    // The stable ID is the owner-approved durable-search binding; access-token
    // expiry and refresh-token rotation do not create a substitute session.
    const successor = this.prepareSession(session.userId, session.id);
    const rotated = await this.runAccountSafetyMutation(
      session.userId,
      "refresh-session",
      `${session.id}:${tokenHash}`,
      async (transaction) => {
        const consumed = await transaction.identitySession.updateMany({
          where: {
            id: session.id,
            userId: session.userId,
            sessionHash: tokenHash,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            sessionHash: successor.session.sessionHash,
            expiresAt: successor.session.expiresAt,
          },
        });
        if (consumed.count !== 1)
          throw new UnauthorizedException("Refresh token replay detected");
        const user = await transaction.user.findUnique({
          where: { id: session.userId },
          select: this.userSelect,
        });
        if (
          !user ||
          user.accountStatus !== UserAccountStatus.ACTIVE ||
          !user.isVerified
        ) {
          throw new UnauthorizedException(
            "Account is not eligible for authentication",
          );
        }
        return user;
      },
    );
    const principal = this.toPrincipal(rotated);
    return { ...successor.tokens, user: principal };
  }

  async logout(refreshToken: string): Promise<void> {
    const raw = this.requireText(refreshToken, "refreshToken");
    const now = new Date();
    const sessionHash = hashRefreshToken(raw);
    const session = await this.prisma.identitySession.findUnique({
      where: { sessionHash },
      select: { id: true, userId: true },
    });
    if (!session) return;
    await this.runAccountSafetyMutation(
      session.userId,
      "logout-session",
      `${session.id}:${sessionHash}`,
      async (transaction) => {
        const revoked = await transaction.identitySession.updateMany({
          where: {
            id: session.id,
            userId: session.userId,
            sessionHash,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        if (revoked.count === 1) {
          await persistSessionRevokedEvent(
            transaction,
            session.userId,
            session.id,
            now,
          );
        }
        return undefined;
      },
    );
  }

  async authenticateAccessToken(token: string): Promise<CanonicalPrincipal> {
    return (await this.authenticateAccessTokenContext(token)).principal;
  }

  async authenticateAccessTokenContext(
    token: string,
  ): Promise<AuthenticatedSessionContext> {
    let payload: {
      sub?: string;
      sid?: string;
      typ?: string;
      exp?: number;
    };
    try {
      payload = this.jwt.verify<{
        sub?: string;
        sid?: string;
        typ?: string;
        exp?: number;
      }>(token, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid access token");
    }

    if (
      payload.typ !== ACCESS_TOKEN_TYPE ||
      !payload.sub ||
      !payload.sid ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException("Invalid access token");
    }

    let subject: string;
    try {
      subject = toCanonicalUserId(payload.sub);
    } catch {
      throw new UnauthorizedException("Invalid access token");
    }

    try {
      const session = await this.prisma.identitySession.findUnique({
        where: { id: payload.sid },
        select: { userId: true, expiresAt: true, revokedAt: true },
      });
      if (
        !session ||
        session.userId !== subject ||
        session.revokedAt ||
        session.expiresAt <= new Date()
      ) {
        throw new UnauthorizedException("Invalid access token");
      }
      return {
        principal: await this.getPrincipal(subject),
        sessionId: payload.sid,
        accessTokenExpiresAt: payload.exp,
      };
    } catch (error: unknown) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        "Canonical authentication authority is unavailable",
      );
    }
  }

  /** Issues an Auth-signed credential scoped only to the anonymous Chat API. */
  async issueChatAccessToken(
    userId: string,
    sessionId: string,
  ): Promise<{ access_token: string; expires_in: number }> {
    const subject = toCanonicalUserId(userId);
    const session = await this.prisma.identitySession.findUnique({
      where: { id: sessionId },
      select: { userId: true, expiresAt: true, revokedAt: true },
    });
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = Math.min(
      CHAT_ACCESS_TTL_SECONDS,
      Math.floor(session ? session.expiresAt.getTime() / 1000 - now : 0),
    );
    if (
      !session ||
      session.userId !== subject ||
      session.revokedAt ||
      expiresIn <= 0
    ) {
      throw new UnauthorizedException("Canonical session is not active");
    }
    // getPrincipal rechecks the Auth-owned account and verification status.
    await this.getPrincipal(subject);
    const secret = this.config.get("JWT_SECRET");
    if (!secret) {
      throw new ServiceUnavailableException(
        "Chat token signing is unavailable",
      );
    }
    const accessToken = this.jwt.sign(
      {
        sub: subject,
        sid: sessionId,
        typ: CHAT_ACCESS_TOKEN_TYPE,
        jti: randomUUID(),
      },
      {
        expiresIn,
        issuer: ISSUER,
        audience: CHAT_AUDIENCE,
        algorithm: "HS256",
        secret,
      },
    );
    return { access_token: accessToken, expires_in: expiresIn };
  }

  /** Auth-only verification for Chat-scoped tokens received through v2 introspection. */
  async authenticateChatAccessTokenContext(
    token: string,
  ): Promise<AuthenticatedSessionContext & { tokenId: string; accessTokenIssuedAt: number }> {
    let payload: {
      sub?: string;
      sid?: string;
      typ?: string;
      jti?: string;
      iat?: number;
      exp?: number;
    };
    try {
      payload = this.jwt.verify(token, {
        issuer: ISSUER,
        audience: CHAT_AUDIENCE,
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid Chat access token");
    }
    if (
      payload.typ !== CHAT_ACCESS_TOKEN_TYPE ||
      !payload.sub ||
      !payload.sid ||
      typeof payload.jti !== "string" ||
      !payload.jti ||
      typeof payload.iat !== "number" ||
      !Number.isSafeInteger(payload.iat) ||
      payload.iat > Math.floor(Date.now() / 1000) ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException("Invalid Chat access token");
    }
    let subject: string;
    try {
      subject = toCanonicalUserId(payload.sub);
    } catch {
      throw new UnauthorizedException("Invalid Chat access token");
    }
    try {
      const session = await this.prisma.identitySession.findUnique({
        where: { id: payload.sid },
        select: { userId: true, expiresAt: true, revokedAt: true },
      });
      if (
        !session ||
        session.userId !== subject ||
        session.revokedAt ||
        session.expiresAt <= new Date()
      ) {
        throw new UnauthorizedException("Invalid Chat access token");
      }
      const principal = await this.getPrincipal(subject);
      return {
        principal,
        sessionId: payload.sid,
        tokenId: payload.jti,
        accessTokenIssuedAt: payload.iat,
        accessTokenExpiresAt: payload.exp,
      };
    } catch (error: unknown) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        "Canonical authentication authority is unavailable",
      );
    }
  }

  async requireRecentSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.identitySession.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { accountStatus: true } },
      },
    });
    const recentWindowMs = 15 * 60 * 1000;
    if (
      !session ||
      session.userId !== toCanonicalUserId(userId) ||
      session.user.accountStatus !== UserAccountStatus.ACTIVE ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      Date.now() - session.createdAt.getTime() > recentWindowMs
    ) {
      throw new UnauthorizedException("Recent authentication is required");
    }
  }

  async listSessions(userId: string) {
    return this.prisma.identitySession.findMany({
      where: {
        userId: toCanonicalUserId(userId),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, expiresAt: true },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const subject = toCanonicalUserId(userId);
    const now = new Date();
    await this.runAccountSafetyMutation(
      subject,
      "revoke-session",
      sessionId,
      async (transaction) => {
        const revoked = await transaction.identitySession.updateMany({
          where: { id: sessionId, userId: subject, revokedAt: null },
          data: { revokedAt: now },
        });
        if (revoked.count === 1) {
          await persistSessionRevokedEvent(
            transaction,
            subject,
            sessionId,
            now,
          );
        }
        return undefined;
      },
    );
  }

  async revokeAllSessions(userId: string): Promise<void> {
    const canonicalUserId = toCanonicalUserId(userId);
    const activeSessions = await this.prisma.identitySession.findMany({
      where: { userId: canonicalUserId, revokedAt: null },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const snapshotKey = activeSessions.map(({ id }) => id).join(",") || "none";
    await this.runAccountSafetyMutation(
      canonicalUserId,
      "revoke-all-sessions",
      snapshotKey,
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${canonicalUserId}::uuid FOR UPDATE`,
        );
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "identity_sessions" WHERE "user_id" = ${canonicalUserId}::uuid AND "revoked_at" IS NULL FOR UPDATE`,
        );
        const sessions = await transaction.identitySession.findMany({
          where: { userId: canonicalUserId, revokedAt: null },
          select: { id: true },
        });
        if (sessions.length === 0) return;
        const now = new Date();
        const revoked = await transaction.identitySession.updateMany({
          where: {
            userId: canonicalUserId,
            revokedAt: null,
            id: { in: sessions.map((session) => session.id) },
          },
          data: { revokedAt: now },
        });
        if (revoked.count !== sessions.length) {
          throw new ConflictException("Sessions changed concurrently");
        }
        for (const session of sessions) {
          await persistSessionRevokedEvent(
            transaction,
            canonicalUserId,
            session.id,
            now,
          );
        }
        return undefined;
      },
    );
  }

  async securityMethods(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: toCanonicalUserId(userId) },
      select: {
        passwordCredential: { select: { userId: true } },
        identityLinks: { select: { provider: true } },
      },
    });
    if (!user) throw new UnauthorizedException("Account is not active");
    return {
      password: Boolean(user.passwordCredential),
      providers: user.identityLinks.map((identity) => identity.provider),
    };
  }

  async unlinkProvider(
    userId: string,
    provider: "GOOGLE" | "APPLE",
  ): Promise<void> {
    const id = toCanonicalUserId(userId);
    await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { id },
        select: {
          passwordCredential: { select: { userId: true } },
          identityLinks: { select: { id: true, provider: true } },
        },
      });
      if (!user) throw new UnauthorizedException("Account is not active");
      const usableMethods =
        Number(Boolean(user.passwordCredential)) + user.identityLinks.length;
      if (usableMethods <= 1) {
        throw new ConflictException(
          "At least one usable sign-in method is required",
        );
      }
      const removed = await transaction.userIdentity.deleteMany({
        where: { userId: id, provider },
      });
      if (removed.count !== 1)
        throw new BadRequestException("Provider is not linked");
    });
  }

  async setPasswordForAuthenticatedUser(
    userId: string,
    password: string,
  ): Promise<void> {
    const id = toCanonicalUserId(userId);
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        email: true,
        username: true,
        passwordCredential: { select: { userId: true } },
      },
    });
    if (!user) throw new UnauthorizedException("Account is not active");
    if (user.passwordCredential)
      throw new ConflictException("Password is already configured");
    const policy = await this.passwordPolicy.evaluate(
      this.requireText(password, "password"),
      {
        userInputs: [user.email, user.username],
        skipHIBP: true,
      },
    );
    if (!policy.compliant || !policy.hash) {
      throw new BadRequestException({
        error: "password_policy_violation",
        violations: policy.violations,
      });
    }
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.user.findUnique({
        where: { id },
        select: { passwordCredential: { select: { userId: true } } },
      });
      if (current?.passwordCredential)
        throw new ConflictException("Password is already configured");
      await transaction.user.update({
        where: { id },
        data: { password: policy.hash },
      });
      await transaction.passwordCredential.create({
        data: { userId: id, passwordHash: policy.hash },
      });
    });
  }

  async getPrincipal(userId: string): Promise<CanonicalPrincipal> {
    const user = await this.prisma.user.findUnique({
      where: { id: toCanonicalUserId(userId) },
      select: this.userSelect,
    });
    if (!user || user.accountStatus !== UserAccountStatus.ACTIVE)
      throw new UnauthorizedException("Account is not active");
    return this.toPrincipal(user);
  }

  async issueSession(principal: CanonicalPrincipal): Promise<SessionTokens> {
    const prepared = this.prepareSession(principal.subject);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${principal.subject}::uuid FOR UPDATE`,
      );
      const user = await transaction.user.findUnique({
        where: { id: principal.subject },
        select: { accountStatus: true, isVerified: true },
      });
      if (
        !user ||
        user.accountStatus !== UserAccountStatus.ACTIVE ||
        !user.isVerified
      ) {
        throw new UnauthorizedException(
          "Account is not eligible for authentication",
        );
      }
      await transaction.identitySession.create({
        data: prepared.session,
        select: { id: true },
      });
    });
    return prepared.tokens;
  }

  private prepareSession(
    subject: string,
    stableSessionId?: string,
  ): {
    session: {
      id: string;
      userId: string;
      sessionHash: string;
      expiresAt: Date;
    };
    tokens: SessionTokens;
  } {
    const refreshToken = randomBytes(48).toString("base64url");
    const sessionId = stableSessionId ?? randomUUID();
    const secret = this.config.get("JWT_SECRET");
    if (!secret)
      throw new ServiceUnavailableException(
        "Canonical session signing is unavailable",
      );
    const testTtl = Number(process.env.AUTH_CANONICAL_ACCESS_TTL_SECONDS);
    const accessTokenTtlSeconds =
      process.env.NODE_ENV === "test" &&
      Number.isInteger(testTtl) &&
      testTtl >= 1 &&
      testTtl <= ACCESS_TTL_SECONDS
        ? testTtl
        : ACCESS_TTL_SECONDS;
    const accessToken = this.jwt.sign(
      { sub: subject, sid: sessionId, typ: ACCESS_TOKEN_TYPE },
      {
        expiresIn: accessTokenTtlSeconds,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithm: "HS256",
        secret,
      },
    );
    return {
      session: {
        id: sessionId,
        userId: subject,
        sessionHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: ACCESS_TTL_SECONDS,
      },
    };
  }

  private async verifyPassword(
    password: string,
    storedHash: string | null,
  ): Promise<boolean> {
    if (!storedHash) return false;
    try {
      if (/^\$2[aby]\$/.test(storedHash))
        return await compareBcryptHash(password, storedHash);
      if (storedHash.startsWith("$argon2"))
        return await verifyArgon2Hash(storedHash, password);
      return false;
    } catch {
      this.logger.warn(
        "Password verification failed without revealing credential details",
      );
      return false;
    }
  }

  private emailVerificationKey(token: string): string {
    return `canonical:email-verification:${createHash("sha256")
      .update(token)
      .digest("hex")}`;
  }

  private readonly userSelect = {
    id: true,
    username: true,
    email: true,
    isVerified: true,
    accountStatus: true,
  } as const;

  private toPrincipal(user: {
    id: string;
    username: string;
    email: string;
    isVerified: boolean;
    accountStatus: UserAccountStatus;
  }): CanonicalPrincipal {
    return {
      subject: toCanonicalUserId(user.id),
      username: user.username,
      email: user.email,
      emailVerified: user.isVerified,
      accountStatus: user.accountStatus,
    };
  }

  private async runAccountSafetyMutation<T>(
    subjectId: string,
    mutationKind: string,
    mutationKey: string,
    commit: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!this.safetyOrdering) {
      throw new ServiceUnavailableException(
        "Auth account safety ordering is unavailable",
      );
    }
    const digest = createHash("sha256")
      .update(
        `auth-account-safety-operation-v1:${mutationKind}:${subjectId.toLowerCase()}:${mutationKey}`,
      )
      .digest("hex");
    const operationId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const commandHash = createHash("sha256")
      .update(
        JSON.stringify([
          "auth-account-safety-mutation-v1",
          mutationKind,
          subjectId.toLowerCase(),
          mutationKey,
        ]),
      )
      .digest("hex");
    return this.safetyOrdering.runAccountMutation({
      operationId,
      subjectId: toCanonicalUserId(subjectId),
      commandHash,
      commit,
    });
  }

  private requireText(value: string, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0)
      throw new BadRequestException(`${field} is required`);
    return value.trim();
  }

  private requireEmail(value: string): string {
    const email = this.requireText(value, "email").toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new BadRequestException("email must be valid");
    return email;
  }
}
