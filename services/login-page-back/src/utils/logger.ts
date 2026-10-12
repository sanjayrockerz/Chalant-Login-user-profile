import winston from 'winston';
import { config } from '../config/environment';
import type { Request, Response, NextFunction } from 'express';

// Augment express Request to include correlationId used by middleware
declare module 'express-serve-static-core' {
  interface Request {
    correlationId?: string;
  }
}

// Type guard used to narrow unknown values to Record<string, unknown>
function isRecordStringUnknown(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// Security function to sanitize log data
function sanitizeLogData(data: unknown): unknown {
  const sensitiveKeys = [
    'password', 'token', 'secret', 'key', 'authorization',
    'auth', 'cookie', 'session', 'credential', 'pin', 'otp',
    'mfa', 'ssn', 'credit', 'bank', 'account'
  ];
  
  if (!isRecordStringUnknown(data)) {
    return data;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    // Check if key contains sensitive information
    const isSensitive = sensitiveKeys.some(sensitiveKey =>
      lowerKey.includes(sensitiveKey)
    );

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (isRecordStringUnknown(value)) {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// Helper to safely extract client IP from request without using `any`
function getRequestIp(req: Request): string {
  const maybeIp = (req as unknown as { ip?: unknown }).ip;
  if (typeof maybeIp === 'string' && maybeIp.length > 0) return maybeIp;

  const s = (req as unknown as { socket?: unknown }).socket;
  if (isRecordStringUnknown(s) && 'remoteAddress' in s && typeof (s as { remoteAddress?: unknown }).remoteAddress === 'string') {
    return (s as { remoteAddress?: string }).remoteAddress as string;
  }

  return 'unknown';
}

// Custom log format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Security: Never log sensitive data
    const sanitizedMeta = sanitizeLogData(meta);
    const metaObject = isRecordStringUnknown(sanitizedMeta) ? sanitizedMeta : {};

    const logEntry = {
      timestamp,
      level,
      message,
      ...metaObject
    };

    return JSON.stringify(logEntry);
  })
);

// Create logger instance
export const logger = winston.createLogger({
  level: config.monitoring.logLevel,
  format: logFormat,
  defaultMeta: { 
    service: 'enterprise-auth',
    version: process.env.npm_package_version || '1.0.0',
    environment: config.environment
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/app.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Error log file
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Security audit log (immutable)
    new winston.transports.File({
      filename: 'logs/security-audit.log',
      level: 'warn',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 10,
      tailable: true
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ]
});

// Security audit logger for compliance
export const securityLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { 
    service: 'enterprise-auth-security',
    auditType: 'security_event'
  },
  transports: [
    new winston.transports.File({
      filename: 'logs/security-events.log',
      maxsize: 100 * 1024 * 1024, // 100MB
      maxFiles: 20,
      tailable: true
    })
  ]
});

// Performance logger for monitoring
export const performanceLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { 
    service: 'enterprise-auth-performance',
    metricType: 'performance'
  },
  transports: [
    new winston.transports.File({
      filename: 'logs/performance.log',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 10,
      tailable: true
    })
  ]
});

// Helper functions for common log patterns
export const logHelpers = {
  // Security event logging
  logSecurityEvent(event: string, details: Record<string, unknown>, userId?: string): void {
    // For policy acceptance events, enforce a strict whitelist to avoid PII leakage
    const timestamp = new Date().toISOString();
    if (event === 'policy_acceptance') {
      const allowed: Record<string, unknown> = {};
      const pv = (details as any).policyVersion || (details as any).policy_version || (details as any).policyversion;
      const at = (details as any).acceptedAt || (details as any).accepted_at || (details as any).acceptedat;
      const source = (details as any).source || 'api';
      const eventId = (details as any).eventId || (details as any).event_id;
      const traceId = (details as any).traceId || (details as any).trace_id;

      if (pv) allowed['policy_version'] = pv;
      if (at) allowed['accepted_at'] = at;
      if (source) allowed['source'] = source;
      if (eventId) allowed['event_id'] = eventId;
      if (traceId) allowed['trace_id'] = traceId;

      securityLogger.warn('Security event: policy_acceptance', {
        event: 'policy_acceptance',
        userId,
        timestamp,
        ...allowed
      });
      return;
    }

    const sanitized = sanitizeLogData(details);
    const detailsObj = isRecordStringUnknown(sanitized) ? sanitized : {};
    securityLogger.warn('Security event detected', {
      event,
      userId,
      timestamp,
      ...detailsObj
    });
  },
  
  // Authentication event logging
  logAuthEvent(event: 'login_attempt' | 'login_success' | 'login_failure' | 'logout', userId: string, details: Record<string, unknown>): void {
    const sanitized = sanitizeLogData(details);
    const detailsObj = isRecordStringUnknown(sanitized) ? sanitized : {};
    securityLogger.info('Authentication event', {
      event,
      userId,
      timestamp: new Date().toISOString(),
      ...detailsObj
    });
  },
  
  // Performance monitoring
  logPerformanceMetric(operation: string, duration: number, details: Record<string, unknown> = {}): void {
    performanceLogger.info('Performance metric', {
      operation,
      duration,
      timestamp: new Date().toISOString(),
      ...details
    });
  },
  
  // Error with correlation ID
  logError(error: Error, correlationId: string, context: Record<string, unknown> = {}): void {
    const sanitized = sanitizeLogData(context);
    const contextObj = isRecordStringUnknown(sanitized) ? sanitized : {};
    logger.error('Application error', {
      error: error.message,
      stack: error.stack,
      correlationId,
      ...contextObj
    });
  }
};

// Middleware for request logging
export function createRequestLogger(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      const rawCorr = (req.headers as Record<string, unknown> | undefined)?.['x-correlation-id'];
      const correlationId = (typeof rawCorr === 'string' && rawCorr.length > 0)
        ? rawCorr
        : `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // attach correlation id to request (augmenting express.Request with a dynamic property is intentional)
    req.correlationId = correlationId;

    // Log request
    logger.info('Incoming request', {
      correlationId,
      method: req.method,
      url: req.url,
      userAgent: typeof (req.headers as Record<string, unknown> | undefined)?.['user-agent'] === 'string'
        ? (req.headers as Record<string, string | undefined>)['user-agent']
        : undefined,
      ip: getRequestIp(req),
      timestamp: new Date().toISOString()
    });

    // Log response
    res.on('finish', () => {
      const duration = Date.now() - start;

      logger.info('Request completed', {
        correlationId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        timestamp: new Date().toISOString()
      });

      // Log performance metrics for slow requests
      if (duration > 1000) { // Slower than 1 second
        logHelpers.logPerformanceMetric('slow_request', duration, {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode
        });
      }
    });

    next();
  };
}

// Ensure log directory exists
import { mkdirSync } from 'fs';
try {
  mkdirSync('logs', { recursive: true });
} catch (error) {
  // Directory might already exist
}

export default logger;
