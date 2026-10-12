import { Router, Request, Response, NextFunction } from 'express';
import { loginRateLimiter } from '../security/rate-limiting/adaptive-limiter';
import { asyncHandler } from '../middleware/error-handler';
import { CredentialService } from '../auth-services/credential-service/credential-service';
import { TokenService } from '../auth-services/token-service/token-service';
import { emitAudit, buildAuditEvent } from '../events/audit-emitter';
import { DatabaseManager } from '../database/database-manager';
import { MFAEngine } from '../auth-services/mfa-engine/mfa-engine';
import { passwordResetRoutes } from './password-reset.routes';

const router = Router();

// Initialize services
const credentialService = new CredentialService();
const tokenService = new TokenService();
const dbManager = DatabaseManager.getInstance();
const mfaEngine = new MFAEngine();

// Mount password reset routes
router.use('/password-reset', passwordResetRoutes);

// Login endpoint
router.post('/login', 
  loginRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password, mfaCode, deviceId } = req.body as {
      email?: string;
      password?: string;
      mfaCode?: string;
      deviceId?: string;
    };
    
    // Basic input validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Simple email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate credentials with proper typing
    const validationResult = await credentialService.validateCredentials(
      email || '', 
      password || ''
    );
    
    if (!validationResult.isValid || !validationResult.user) {
      return res.status(401).json({
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const user = validationResult.user;
    
    // Check if MFA is required
    if (user.mfaEnabled && !mfaCode) {
      return res.status(200).json({
        requiresMfa: true,
        tempToken: await tokenService.createTempToken(user.id)
      });
    }
    
    // Validate MFA if provided
    if (user.mfaEnabled && mfaCode) {
      const mfaValid = await mfaEngine.validateCode(user.id, mfaCode);
      if (!mfaValid) {
        return res.status(401).json({
          error: 'Invalid MFA code',
          code: 'INVALID_MFA'
        });
      }
    }
    
    // Extract safe headers
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
    const clientIp = (req as { ip?: string }).ip;
    
    // Generate tokens
    const tokens = await tokenService.generateTokens(user, {
      deviceId,
      ip: clientIp,
      userAgent
    });
    
    // Emit standardized audit event for successful login
    await emitAudit({
      service: 'auth-service',
      action: 'login',
      outcome: 'success',
      timestamp: Date.now(),
      correlationId: (res as any).locals?.correlation_id,
      actor: user.id,
      actorType: 'user',
      tenantId: (user as any).tenantId || (user as any).tenant_id,
      ipAddress: clientIp,
      userAgent: userAgent,
      metadata: {
        method: 'password',
        mfa_used: user.mfaEnabled,
        deviceId
      }
    });
    
    // Return tokens in the flat shape expected by tests (and keep tokens object for compatibility)
    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        lastLogin: new Date().toISOString()
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType,
      tokens
    });
  })
);

// Profile endpoint - protected
router.get('/profile', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const payload = await tokenService.validateAccessToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await dbManager.findUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.status(200).json({ id: user.id, email: user.email });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Token refresh endpoint
router.post('/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    const tokens = await tokenService.refreshTokens(refreshToken || '');

    // Enforce re-acceptance on refresh if active policy is material and user hasn't accepted
    try {
      const activePolicy = process.env.ACTIVE_POLICY_VERSION || 'v2025-10-07-1';
      const activeIsMaterial = (process.env.ACTIVE_POLICY_IS_MATERIAL || 'true').toLowerCase() === 'true';
      // we can obtain user id from tokens payload in tokenService.refreshTokens implementation if returned; tokenService.refreshTokens above returns tokens but we still have payload earlier
      // For be lightweight here, query user by refresh token payload subject after verification in TokenService (relying on tokenService to throw AuthenticationError if invalid)
    } catch (e) {
      // no-op; enforcement handled below in tokenService where user is read
    }

    // Emit standardized audit event for token refresh
    await emitAudit({
      service: 'auth-service',
      action: 'token_refresh',
      outcome: 'success',
      timestamp: Date.now(),
      correlationId: (res as any).locals?.correlation_id,
      actorType: 'system',
      ipAddress: (req as any).ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      metadata: { source: 'refresh_endpoint' }
    });

    // Return tokens in the same flat shape as /login
    res.status(200).json({
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType,
      tokens
    });
  })
);

// Logout endpoint
router.post('/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    
    await tokenService.revokeToken(refreshToken || '');
    
    // Emit standardized audit event for logout
    await emitAudit({
      service: 'auth-service',
      action: 'logout',
      outcome: 'success',
      timestamp: Date.now(),
      correlationId: (res as any).locals?.correlation_id,
      actorType: 'user',
      ipAddress: (req as any).ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      metadata: { source: 'logout_endpoint' }
    });
    
    res.status(200).json({ success: true });
  })
);

// MFA setup endpoint
router.post('/mfa/setup',
  // TODO: Add authentication middleware
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.body as { userId?: string }; // This should come from auth middleware
    
    const mfaSetup = await mfaEngine.setupMFA(userId || '');
    
    res.status(200).json(mfaSetup);
  })
);

export { router as authRoutes };

// Optional Prometheus metrics endpoint (lazy require to avoid hard dependency)
try {
  // Add a route to expose metrics if prom-client is available
  const expressAppRouter = router as any;
  router.get('/metrics', async (req: Request, res: Response) => {
    try {
      // Lazy require
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const promClient = require('prom-client');
      const registry = promClient.register;
      res.set('Content-Type', registry.contentType);
      res.send(await registry.metrics());
    } catch (err) {
      res.status(404).send('Metrics not enabled');
    }
  });
} catch (err) {
  // no-op: environment likely doesn't support optional metrics
}
