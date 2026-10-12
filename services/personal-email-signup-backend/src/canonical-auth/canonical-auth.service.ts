import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, UserAccountStatus } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { verify as verifyArgon2 } from "@node-rs/argon2";
import { compare as compareBcrypt } from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
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

const ACCESS_TOKEN_TYPE = "canonical-access";
const ISSUER = "r3-canonical-identity";
const AUDIENCE = "r3-api";
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
  ) {}

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
        return transaction.user.create({
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
      });
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
      throw new UnauthorizedException("Account is not active");
    }
    if (!user.isVerified) {
      throw new UnauthorizedException("Email verification is required");
    }

    const principal = this.toPrincipal(user);
    const tokens = await this.issueSession(principal);
    return { ...tokens, user: principal };
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

    const rotated = await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.identitySession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
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
    });
    const principal = this.toPrincipal(rotated);
    return { ...(await this.issueSession(principal)), user: principal };
  }

  async logout(refreshToken: string): Promise<void> {
    const raw = this.requireText(refreshToken, "refreshToken");
    await this.prisma.identitySession.updateMany({
      where: { sessionHash: hashRefreshToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async authenticateAccessToken(token: string): Promise<CanonicalPrincipal> {
    return (await this.authenticateAccessTokenContext(token)).principal;
  }

  async authenticateAccessTokenContext(
    token: string,
  ): Promise<AuthenticatedSessionContext> {
    try {
      const payload = this.jwt.verify<{
        sub?: string;
        sid?: string;
        typ?: string;
      }>(token, {
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (payload.typ !== ACCESS_TOKEN_TYPE || !payload.sub || !payload.sid) {
        throw new Error("Invalid canonical access claims");
      }
      const subject = toCanonicalUserId(payload.sub);
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
        throw new Error("Session is not active");
      }
      return {
        principal: await this.getPrincipal(subject),
        sessionId: payload.sid,
      };
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new UnauthorizedException("Invalid access token");
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
    await this.prisma.identitySession.updateMany({
      where: {
        id: sessionId,
        userId: toCanonicalUserId(userId),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.identitySession.updateMany({
      where: { userId: toCanonicalUserId(userId), revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
    const refreshToken = randomBytes(48).toString("base64url");
    const session = await this.prisma.identitySession.create({
      data: {
        userId: principal.subject,
        sessionHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
      select: { id: true },
    });
    const secret = this.config.get("JWT_SECRET");
    if (!secret)
      throw new ServiceUnavailableException(
        "Canonical session signing is unavailable",
      );
    const accessToken = this.jwt.sign(
      { sub: principal.subject, sid: session.id, typ: ACCESS_TOKEN_TYPE },
      {
        expiresIn: ACCESS_TTL_SECONDS,
        issuer: ISSUER,
        audience: AUDIENCE,
        secret,
      },
    );
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: ACCESS_TTL_SECONDS,
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
