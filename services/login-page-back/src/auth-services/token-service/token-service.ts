import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { DatabaseManager, User, RefreshToken } from '../../database/database-manager';
import { CacheManager } from '../../database/cache-manager';
import { config } from '../../config/environment';
import { logger, logHelpers } from '../../utils/logger';
import { emitAudit } from '../../events/audit-emitter';
import { AuthenticationError } from '../../middleware/error-handler';

export interface TokenPayload {
  sub: string; // user id
  email: string;
  jti: string; // JWT ID
  iat: number; // issued at
  exp: number; // expires at
  iss: string; // issuer
  aud: string; // audience
  cnf?: { // confirmation claim for token binding
    kid: string; // key identifier (device fingerprint)
  };
  amr?: string[]; // authentication methods references
  scope?: string[];
}

export interface SessionInfo {
  deviceId?: string;
  ip?: string;
  userAgent?: string;
  fingerprint?: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  scope?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  type: 'refresh';
}

export class TokenService {
  private dbManager: DatabaseManager;
  private cacheManager: CacheManager;

  constructor() {
    this.dbManager = DatabaseManager.getInstance();
    this.cacheManager = CacheManager.getInstance();
  }

  /**
   * Generate access and refresh tokens for a user
   */
  public async generateTokens(user: User, sessionInfo: SessionInfo): Promise<Tokens> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const accessJti = this.generateJti();
      const refreshJti = this.generateJti();
      
      // Create device fingerprint for token binding
      const deviceFingerprint = this.createDeviceFingerprint(sessionInfo);
      
      // Access token payload (1 hour)
      const accessPayload: TokenPayload = {
        sub: user.id,
        email: user.email,
        jti: accessJti,
        iat: now,
        exp: now + 3600, // 1 hour
        iss: config.jwt.issuer,
        aud: config.jwt.audience,
        cnf: deviceFingerprint ? { kid: deviceFingerprint } : undefined,
        amr: user.mfaEnabled ? ['pwd', 'mfa'] : ['pwd'],
        scope: ['read', 'write']
      };

      // Refresh token payload (7 days)
      const refreshPayload: RefreshTokenPayload = {
        sub: user.id,
        jti: refreshJti,
        iat: now,
        exp: now + (7 * 24 * 3600), // 7 days
        iss: config.jwt.issuer,
        aud: config.jwt.audience,
        type: 'refresh'
      };

      // Sign tokens
      const accessToken = jwt.sign(accessPayload, config.jwt.accessSecret, {
        algorithm: 'HS256'
      });

      const refreshToken = jwt.sign(refreshPayload, config.jwt.refreshSecret, {
        algorithm: 'HS256'
      });

  // Store refresh token in database (store hash of the raw token)
  await this.storeRefreshToken(refreshToken, user.id, sessionInfo, refreshPayload.exp);

      // Cache access token metadata
      await this.storeTokenMetadata(accessJti, user.id, sessionInfo, accessPayload.exp);

      logHelpers.logSecurityEvent('tokens_generated', {
        userId: user.id,
        accessJti,
        refreshJti,
        deviceId: sessionInfo.deviceId,
        ip: sessionInfo.ip
      });

      return {
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'read write'
      };

    } catch (error) {
      logger.error('Error generating tokens', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to generate tokens');
    }
  }

  /**
   * Validate access token
   */
  public async validateAccessToken(token: string): Promise<TokenPayload | null> {
    try {
      const payload = jwt.verify(token, config.jwt.accessSecret) as TokenPayload;
      
      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(payload.jti);
      if (isBlacklisted) {
        logHelpers.logSecurityEvent('blacklisted_token_used', {
          userId: payload.sub,
          jti: payload.jti
        });
        return null;
      }

      return payload;
    } catch (error) {
      logger.warn('Invalid access token', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  public async refreshTokens(refreshToken: string): Promise<Tokens> {
    try {
      // Verify refresh token - explicitly handle JWT errors so they map to 401
      let payload: RefreshTokenPayload;
      try {
        payload = jwt.verify(refreshToken, config.jwt.refreshSecret) as RefreshTokenPayload;
      } catch (err: any) {
        // Map JWT verification errors to AuthenticationError so middleware returns 401
        if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
          throw new AuthenticationError('Invalid refresh token');
        }
        throw err;
      }

      // Get token data from database
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const tokenData = await this.dbManager.findRefreshToken(tokenHash);

      if (!tokenData || tokenData.isRevoked) {
        throw new AuthenticationError('Invalid refresh token');
      }

      // Get user data
      const user = await this.dbManager.findUserById(payload.sub);
      if (!user) {
        throw new AuthenticationError('Invalid refresh token');
      }

      // Enforcement: if the active policy is material and enforcement mode applies, require re-acceptance
      try {
        const activePolicy = process.env.ACTIVE_POLICY_VERSION || '';
        const activeIsMaterial = (process.env.ACTIVE_POLICY_IS_MATERIAL || 'false').toLowerCase() === 'true';
        const ENFORCE_MODE = (process.env.REQUIRE_TERMS_ENFORCE_MODE || 'off').toLowerCase();
        const CANARY_TENANTS = (process.env.REQUIRE_TERMS_CANARY_TENANTS || '').split(',').map(s => s.trim()).filter(Boolean);
        const tenantId = (user as any).tenantId || (user as any).tenant_id || null;

        const shouldEnforce = ENFORCE_MODE === 'global' || (ENFORCE_MODE === 'canary' && tenantId && CANARY_TENANTS.includes(String(tenantId)));

        if (activeIsMaterial && shouldEnforce) {
          if (!user.termsVersion || user.termsVersion !== activePolicy) {
            // Emit audit event indicating enforcement-block
            try {
              await emitAudit({
                service: 'auth-service',
                action: 'policy_enforcement_block',
                outcome: 'failure',
                timestamp: Date.now(),
                actor: user.id,
                actorType: 'user',
                tenantId: tenantId || undefined,
                metadata: {
                  reason: 'terms_not_accepted',
                  activePolicy,
                  userTerms: user.termsVersion || null
                }
              });
            } catch (auditErr) {
              logger.warn('Failed to emit enforcement audit', { error: auditErr instanceof Error ? auditErr.message : String(auditErr) });
            }

            throw new AuthenticationError('User must accept the active terms before refreshing tokens');
          }
        }
      } catch (e) {
        // Best-effort enforcement: if environment not configured or check fails, continue
      }

      // Create session info from stored data
      const sessionInfo: SessionInfo = {
        deviceId: tokenData.deviceId,
        ip: tokenData.ipAddress,
        userAgent: tokenData.userAgent
      };

      // Generate new tokens
      const newTokens = await this.generateTokens(user, sessionInfo);

      // Revoke old refresh token
      await this.revokeRefreshToken(tokenData.tokenHash);

      logHelpers.logSecurityEvent('tokens_refreshed', {
        userId: payload.sub,
        oldJti: payload.jti
      });

      return newTokens;

    } catch (error) {
      // If it's an AppError (AuthenticationError) rethrow to be handled as-is
      if (error instanceof AuthenticationError) {
        throw error;
      }

      logger.error('Error refreshing tokens', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to refresh tokens');
    }
  }

  /**
   * Revoke a single token
   */
  public async revokeToken(token: string): Promise<boolean> {
    try {
      const payload = jwt.decode(token) as TokenPayload;
      if (!payload || !payload.jti) {
        return false;
      }

      // Blacklist access token
      await this.blacklistToken(payload.jti, payload.exp);

      // If it's a refresh token, revoke from database
      if ((payload as any).type === 'refresh') {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        await this.revokeRefreshToken(tokenHash);
      }

      logHelpers.logSecurityEvent('token_revoked', {
        userId: payload.sub,
        jti: payload.jti
      });

      return true;
    } catch (error) {
      logger.error('Error revoking token', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Revoke all tokens for a user
   */
  public async revokeAllUserTokens(userId: string): Promise<boolean> {
    try {
      // Get all refresh tokens for user and revoke them
      const revoked = await this.dbManager.revokeUserTokens(userId);

      // Get all active access tokens from cache and blacklist them
      const keys = await this.cacheManager.keys(`token_meta:*`, { prefix: 'auth' });
      
      for (const key of keys) {
        const metadata = await this.cacheManager.get(key);
        if (metadata && (metadata as any).userId === userId) {
          const jti = key.split(':')[1];
          await this.blacklistToken(jti, (metadata as any).exp);
          await this.removeTokenMetadata(jti);
        }
      }

      logHelpers.logSecurityEvent('all_user_tokens_revoked', {
        userId
      });

      return revoked;
    } catch (error) {
      logger.error('Error revoking all user tokens', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Create temporary token for MFA flow
   */
  public async createTempToken(userId: string): Promise<string> {
    try {
      const jti = this.generateJti();
      const now = Math.floor(Date.now() / 1000);
      
      const payload = {
        sub: userId,
        jti,
        iat: now,
        exp: now + 300, // 5 minutes
        iss: config.jwt.issuer,
        aud: config.jwt.audience,
        type: 'temp'
      };

      const token = jwt.sign(payload, config.jwt.accessSecret, {
        algorithm: 'HS256'
      });

      // Store temp token metadata
      await this.cacheManager.set(`temp_token:${jti}`, {
        userId,
        createdAt: now,
        type: 'temp'
      }, { ttl: 300 });

      return token;
    } catch (error) {
      logger.error('Error creating temp token', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to create temp token');
    }
  }

  /**
   * Store token metadata in cache
   */
  private async storeTokenMetadata(jti: string, userId: string, sessionInfo: SessionInfo, exp: number): Promise<void> {
    try {
      const key = `token_meta:${jti}`;
      const metadata = {
        userId,
        deviceId: sessionInfo.deviceId,
        ip: sessionInfo.ip,
        userAgent: sessionInfo.userAgent,
        createdAt: Math.floor(Date.now() / 1000),
        exp
      };

      const ttl = exp - Math.floor(Date.now() / 1000);
      await this.cacheManager.set(key, metadata, { ttl });
    } catch (error) {
      logger.error('Error storing token metadata', {
        jti,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get token metadata from cache
   */
  private async getTokenMetadata(jti: string): Promise<any | null> {
    try {
      return await this.cacheManager.get(`token_meta:${jti}`);
    } catch (error) {
      logger.error('Error getting token metadata', {
        jti,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Remove token metadata from cache
   */
  private async removeTokenMetadata(jti: string): Promise<void> {
    try {
      await this.cacheManager.del(`token_meta:${jti}`);
    } catch (error) {
      logger.error('Error removing token metadata', {
        jti,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Blacklist token
   */
  private async blacklistToken(jti: string, exp: number): Promise<void> {
    try {
      const ttl = exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.cacheManager.set(`blacklist:${jti}`, true, { ttl });
      }
    } catch (error) {
      logger.error('Error blacklisting token', {
        jti,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check if token is blacklisted
   */
  private async isTokenBlacklisted(jti: string): Promise<boolean> {
    try {
      const exists = await this.cacheManager.exists(`blacklist:${jti}`);
      return exists;
    } catch (error) {
      logger.error('Error checking token blacklist', {
        jti,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Store refresh token in database
   */
  private async storeRefreshToken(refreshToken: string, userId: string, sessionInfo: SessionInfo, exp: number): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await this.dbManager.createRefreshToken({
      userId,
      tokenHash,
      expiresAt: new Date(exp * 1000),
      deviceId: sessionInfo.deviceId,
      ipAddress: sessionInfo.ip,
      userAgent: sessionInfo.userAgent,
      isRevoked: false
    });
  }

  /**
   * Revoke refresh token
   */
  private async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.dbManager.revokeRefreshToken(tokenHash);
  }

  /**
   * Generate unique JWT ID
   */
  private generateJti(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Create device fingerprint for token binding
   */
  private createDeviceFingerprint(sessionInfo: SessionInfo): string | null {
    if (!sessionInfo.userAgent || !sessionInfo.ip) {
      return null;
    }

    const data = `${sessionInfo.userAgent}:${sessionInfo.ip}:${sessionInfo.deviceId || ''}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }
}
