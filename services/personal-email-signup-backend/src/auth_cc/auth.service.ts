// filepath: src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { UserService } from "../user/user.service"; // Import your UserService to fetch user data
import { randomBytes, randomUUID } from "crypto";
import { EmailService } from "../email/email.service"; // Import EmailService
import { CreateUserDto } from "./dto/create-user.dto";
import { Redis } from "ioredis";
import { Body, Post, Res } from "@nestjs/common";
import { Response } from "express";
import { PrismaClient } from "@prisma/client";
import { RedisService } from "../redis/redis.service"; // Import RedisService
import { ConfigService } from "../config/config.service";
import { MetricsService } from "../metrics/metrics.service";
import { normalizeUsername } from "../user/username-normalize";
import {
  emitAudit,
  buildAuditEvent,
} from "../../../login-page-back/src/events/audit-emitter";
import { PasswordBreachService } from "../security/password-breach.service";
import { TermsService } from "./terms.service";

export interface PrismaUser {
  id: string;
  username: string;
  email: string;
  password: string;
  isVerified: boolean;
  verificationToken?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  isVerified: boolean;
  verificationToken?: string; // Add this property
  createdAt: Date;
  updatedAt: Date;
}

export interface LocalUser {
  id: string;
  username: string;
  email: string;
  password: string;
  isVerified: boolean;
  verificationToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private redisClient: Redis;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly passwordBreach: PasswordBreachService,
    private readonly termsService: TermsService,
    private readonly userService: UserService,
    private readonly emailService: EmailService,
    private readonly metricsService: MetricsService,
    private readonly redisService: RedisService,
  ) {
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
    });

    this.redisClient.on("connect", () => {
      console.log("Connected to Redis successfully");
    });

    this.redisClient.on("error", (err) => {
      console.error("Redis connection error:", err);
    });
  }

  @Post("login")
  async login(
    @Body() body: { username: string; password: string },
    @Res() res: Response,
  ) {
    const user = await this.validateUser(body.username, body.password);
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Check terms enforcement during login
    const ENFORCE_TERMS_MODE =
      (this.configService &&
        this.configService.get("REQUIRE_TERMS_ENFORCE_MODE")) ||
      process.env.REQUIRE_TERMS_ENFORCE_MODE ||
      "off";
    const ACTIVE_POLICY_VERSION =
      (this.configService && this.configService.get("ACTIVE_POLICY_VERSION")) ||
      process.env.ACTIVE_POLICY_VERSION ||
      "v2025-10-07-1";

    if (ENFORCE_TERMS_MODE === "enforce") {
      if (!user.termsVersion || user.termsVersion !== ACTIVE_POLICY_VERSION) {
        // Return 403 with terms acceptance required error
        return res.status(403).json({
          error: "terms_acceptance_required",
          message: "User must accept current terms and policies before login",
          required_version: ACTIVE_POLICY_VERSION,
          user_version: user.termsVersion || null,
          correlation_id: res.getHeader("x-correlation-id") || "unknown",
        });
      }
    }

    const tokens = await this.generateTokens(user);

    // Dynamically set the `secure` option based on the environment
    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("accessToken", tokens.accessToken, {
      httpOnly: true,
      secure: isProduction, // Only secure in production
    });
    res.cookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction, // Only secure in production
    });

    return res.send({ message: "Logged in successfully" });
  }

  async hashPassword(password: string): Promise<string> {
    // Use Argon2id with secure configuration
    return hash(password, {
      // Algorithm variant (Argon2id recommended for password hashing)
      algorithm: Algorithm.Argon2id,
      // Memory usage in KB (64MB recommended)
      memoryCost: 64 * 1024,
      // Number of iterations (3-4 recommended for Argon2id)
      timeCost: 3,
      // Parallelism factor (number of threads)
      parallelism: 1,
      // Hash output length
      outputLen: 32,
    });
  }

  async validatePassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    try {
      return verify(hashedPassword, password);
    } catch (error) {
      // Log the error but don't expose details
      console.error("Password verification error:", error);
      return false;
    }
  }

  async validateUser(username: string, password: string): Promise<any> {
    const user = await this.userService.findByUsername(username); // Fetch user by username
    if (user && (await this.validatePassword(password, user.password))) {
      const { password, ...result } = user; // Exclude password from the result
      return result;
    }
    return null;
  }

  async generateVerificationToken(): Promise<string> {
    return randomBytes(32).toString("hex");
  }

  async register(createUserDto: CreateUserDto): Promise<any> {
    const correlationId = randomUUID();

    try {
      // Phase A: Terms Acceptance Enforcement using TermsService
      const termsValidation = this.termsService.validateRegistrationTerms(
        createUserDto.terms_version,
      );
      if (!termsValidation.valid) {
        // Update metrics if available
        try {
          if (this.metricsService) {
            this.metricsService.errorsTotal.inc({
              type: "terms_acceptance_required",
            });
          }
        } catch (err) {
          // ignore metrics failures
        }

        throw new BadRequestException(termsValidation.error);
      }

      // Phase B: Identity validation with age gating
      const MIN_DECLARED_AGE =
        (this.configService &&
          (this.configService.get("MIN_DECLARED_AGE") as number)) ||
        parseInt(process.env.MIN_DECLARED_AGE || "13", 10);

      if (
        createUserDto.declared_age !== undefined &&
        createUserDto.declared_age !== null &&
        typeof createUserDto.declared_age !== "number"
      ) {
        throw new BadRequestException(
          "Declared age must be provided as a number.",
        );
      }

      if (createUserDto.profile_image_url) {
        try {
          // eslint-disable-next-line no-new
          new URL(createUserDto.profile_image_url);
        } catch {
          throw new BadRequestException(
            "Profile image URL must be a valid absolute URL.",
          );
        }
      }

      if (typeof createUserDto.declared_age === "number") {
        if (createUserDto.declared_age < MIN_DECLARED_AGE) {
          // Centralized metric update (if available)
          try {
            if (this.metricsService) {
              this.metricsService.underageDeniedTotal.inc();
            }
          } catch (err) {
            // ignore metrics failures
          }

          // Emit a minimal audit event (PII-safe)
          try {
            await emitAudit(
              buildAuditEvent(
                { user: { userId: null }, headers: {}, body: {} } as any,
                "identity.validation",
                "failure",
                {
                  service: "personal-email-signup-backend",
                  outcome: "rejected_underage",
                  metadata: {
                    declared_age: createUserDto.declared_age,
                    min_allowed: MIN_DECLARED_AGE,
                  },
                } as any,
              ),
            );
          } catch (err) {
            // no-op if audit-emitter not available
          }

          throw new BadRequestException(
            "Registration denied: declared age below allowed minimum",
          );
        }
      }

      // Continue with registration flow
      const start = Date.now();

      // Password breach screening
      if (this.passwordBreach) {
        try {
          const breachResult = await this.passwordBreach.checkPassword(
            createUserDto.password,
          );
          if (breachResult.isBreached) {
            // Log security event
            this.logger.warn(`Password breach detected during registration`, {
              source: breachResult.source,
              breachCount: breachResult.breachCount,
              userEmail: createUserDto.email?.substring(0, 3) + "***", // Partial email for logging
            });

            // Update metrics
            try {
              if (this.metricsService) {
                this.metricsService.errorsTotal.inc({
                  type: "password_breach_detected",
                });
              }
            } catch (err) {
              // ignore metrics failures
            }

            throw new BadRequestException({
              error: "PASSWORD_SECURITY_VIOLATION",
              message:
                "This password has been found in known data breaches and cannot be used. Please choose a different password.",
              breach_count:
                breachResult.breachCount && breachResult.breachCount > 100
                  ? "100+"
                  : breachResult.breachCount?.toString() || "unknown",
            });
          }
        } catch (error) {
          // Don't block registration if breach service fails
          this.logger.error(
            "Password breach check failed, allowing registration:",
            error,
          );
        }
      }

      // Persist user with only pointer to profile image, and optional display name / pronouns
      const normalizedUsername =
        this.configService &&
        this.configService.get("REQUIRE_USERNAME_NORMALIZATION")
          ? normalizeUsername(createUserDto.username)
          : undefined;

      const passwordHash = await this.hashPassword(createUserDto.password);

      const newUser = await this.userService.createUser({
        username: createUserDto.username,
        normalizedUsername: normalizedUsername as any,
        displayUsername: createUserDto.display_name || createUserDto.username,
        email: createUserDto.email,
        password: passwordHash,
        isVerified: false,
        // pass through optional identity fields; Prisma schema will need these columns
        // profile_image_url intentionally only a pointer
        displayName: createUserDto.display_name as any,
        declaredAge: createUserDto.declared_age as any,
        profileImageUrl: createUserDto.profile_image_url as any,
        pronouns: createUserDto.pronouns as any,
        usernameUpdatedAt: normalizedUsername ? new Date() : undefined,
      });

      // Centralized metrics (if the MetricsService is available)
      try {
        if (this.metricsService) {
          this.metricsService.identityRegistrationsTotal.inc();
          this.metricsService.identityValidationLatency.observe(
            (Date.now() - start) / 1000,
          );
        }
      } catch (err) {
        // ignore metric failures
      }

      try {
        await emitAudit(
          buildAuditEvent(
            { user: { userId: newUser.id }, headers: {}, body: {} } as any,
            "identity.validation",
            "success",
            {
              service: "personal-email-signup-backend",
              outcome: "success",
              metadata: {
                userId: newUser.id,
                declared_age_provided:
                  typeof createUserDto.declared_age === "number",
              },
            } as any,
          ),
        );
      } catch (err) {
        // no-op
      }

      // Legacy token-based verification (deprecated - will be removed in Phase C)
      // TODO: Remove this block when ENABLE_LEGACY_TOKEN_VERIFICATION=false everywhere
      const verificationToken = await this.generateVerificationToken();
      console.log("Generated verification token:", verificationToken); // Log the token

      await this.userService.saveVerificationToken(
        newUser.id,
        verificationToken,
      );
      console.log(
        "Token saved to database for user:",
        newUser.id,
        "Email:",
        newUser.email,
      ); // Log the user ID and email

      await this.emailService.sendVerificationEmail(
        newUser.email,
        verificationToken,
      );
      console.log("Verification email sent to:", newUser.email); // Log email sent

      return { message: "Registration successful. Please verify your email." };
    } catch (error) {
      // Log the error for debugging
      this.logger.error("Registration failed", error);
      throw error;
    }
  }

  async verifyEmail(token: string): Promise<string> {
    console.log("Received token for verification:", token); // Log the token

    const user = await this.userService.findByVerificationToken(token);
    if (!user) {
      console.error("Token not found in database:", token); // Log if token is not found
      throw new BadRequestException("Email verification failed");
    }

    console.log("User found for token:", user); // Log the user details

    user.isVerified = true;
    await this.userService.updateUser(user.id, user);
    console.log("User marked as verified:", user.id); // Log user verification

    return "Email verified successfully";
  }

  async generateTokens(user: any) {
    const jti = randomUUID(); // Generate a unique identifier for the token
    const payload = { sub: user.id, username: user.username, jti }; // Include jti in the payload

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: "15m", // Access token expires in 15 minutes
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: "7d", // Refresh token expires in 7 days
    });

    return { accessToken, refreshToken };
  }

  /**
   * Blacklist a token by storing it in Redis with a TTL.
   * @param token - The JWT token to blacklist.
   * @param expiresIn - TTL for the token.
   */
  async blacklistToken(token: string, expiresIn: number) {
    await this.redisService.set(`blacklist:${token}`, "true", expiresIn);
  }

  /**
   * Check if a token is blacklisted by querying Redis.
   * @param token - The JWT token to check.
   * @returns A boolean indicating whether the token is blacklisted.
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await this.redisService.get(`blacklist:${token}`);
    return result === "true";
  }
}
