import { ContactImportService } from './secure-contact-import.service';
import { 
  ContactImportController, 
  ContactPrivacyController, 
  ContactAdminController 
} from './contact-import.controller';

/**
 * Contact Import Module
 * 
 * Provides secure contact discovery functionality with privacy-by-design
 * architecture, comprehensive data protection, and regulatory compliance.
 * 
 * Features:
 * - Cryptographic contact hashing (Argon2id simulation with PBKDF2)
 * - Mutual consent discovery system
 * - Automatic data expiration
 * - PII redaction in all logs
 * - GDPR/CCPA compliance
 * - Transparent privacy controls
 */
export class ContactImportModule {
  private readonly contactImportService: ContactImportService;
  private readonly contactImportController: ContactImportController;
  private readonly contactPrivacyController: ContactPrivacyController;
  private readonly contactAdminController: ContactAdminController;

  constructor(
    redis: any,
    database: any,
    logger?: (level: string, message: string, context?: any) => void,
  ) {
    // Initialize service with dependencies
    this.contactImportService = new ContactImportService(redis, database, logger);
    
    // Initialize controllers
    this.contactImportController = new ContactImportController(this.contactImportService);
    this.contactPrivacyController = new ContactPrivacyController(this.contactImportService);
    this.contactAdminController = new ContactAdminController(this.contactImportService);
  }

  /**
   * Get the contact import service instance
   */
  getContactImportService(): ContactImportService {
    return this.contactImportService;
  }

  /**
   * Get the main contact import controller
   */
  getContactImportController(): ContactImportController {
    return this.contactImportController;
  }

  /**
   * Get the privacy-focused controller
   */
  getContactPrivacyController(): ContactPrivacyController {
    return this.contactPrivacyController;
  }

  /**
   * Get the admin controller for system monitoring
   */
  getContactAdminController(): ContactAdminController {
    return this.contactAdminController;
  }

  /**
   * Setup cron jobs for automated cleanup
   */
  setupCleanupJobs(cronScheduler: any): void {
    // Daily cleanup at 2 AM
    cronScheduler.schedule('0 2 * * *', async () => {
      try {
        const result = await this.contactImportService.cleanupExpiredData();
        console.log(`Automated cleanup completed: ${result.cleaned} records cleaned`);
      } catch (error) {
        console.error('Automated cleanup failed:', error);
      }
    });

    console.log('Contact discovery cleanup jobs scheduled');
  }

  /**
   * Health check for the contact discovery system
   */
  async healthCheck(): Promise<{ status: string; checks: any }> {
    const checks = {
      serviceInitialized: !!this.contactImportService,
      controllersInitialized: !!(
        this.contactImportController &&
        this.contactPrivacyController &&
        this.contactAdminController
      ),
      timestamp: new Date().toISOString(),
    };

    const status = Object.values(checks).every(check => 
      typeof check === 'boolean' ? check : true
    ) ? 'healthy' : 'unhealthy';

    return { status, checks };
  }
}

/**
 * Router configuration for contact discovery endpoints
 * 
 * This provides a framework-agnostic way to define the API routes
 * that can be adapted to Express, Fastify, NestJS, or other frameworks.
 */
export interface ContactDiscoveryRoutes {
  // Main contact import endpoints
  'POST /api/contacts/import': (userId: string, body: any) => Promise<any>;
  'GET /api/contacts/preferences': (userId: string) => Promise<any>;
  'PUT /api/contacts/preferences': (userId: string, body: any) => Promise<any>;
  'GET /api/contacts/discoveries': (userId: string) => Promise<any>;
  'DELETE /api/contacts/data': (userId: string) => Promise<any>;
  
  // Privacy compliance endpoints
  'GET /api/privacy/contact-data-export': (userId: string) => Promise<any>;
  'POST /api/privacy/delete-contact-data': (userId: string) => Promise<any>;
  'GET /api/privacy/transparency-report': (userId: string) => Promise<any>;
  
  // Admin endpoints
  'POST /api/admin/cleanup-expired-data': () => Promise<any>;
  'GET /api/admin/system-health': () => Promise<any>;
}

/**
 * Route factory function
 * 
 * Creates route handlers that can be used with any web framework
 */
export function createContactDiscoveryRoutes(module: ContactImportModule): ContactDiscoveryRoutes {
  const importController = module.getContactImportController();
  const privacyController = module.getContactPrivacyController();
  const adminController = module.getContactAdminController();

  return {
    'POST /api/contacts/import': (userId: string, body: any) => 
      importController.importContacts(userId, body),
    
    'GET /api/contacts/preferences': (userId: string) => 
      importController.getDiscoveryPreferences(userId),
    
    'PUT /api/contacts/preferences': (userId: string, body: any) => 
      importController.updateDiscoveryPreferences(userId, body),
    
    'GET /api/contacts/discoveries': (userId: string) => 
      importController.getDiscoveryHistory(userId),
    
    'DELETE /api/contacts/data': (userId: string) => 
      importController.deleteContactData(userId),
    
    'GET /api/privacy/contact-data-export': (userId: string) => 
      privacyController.exportContactData(userId),
    
    'POST /api/privacy/delete-contact-data': (userId: string) => 
      privacyController.requestDataDeletion(userId),
    
    'GET /api/privacy/transparency-report': (userId: string) => 
      privacyController.getTransparencyReport(userId),
    
    'POST /api/admin/cleanup-expired-data': () => 
      adminController.triggerCleanup(),
    
    'GET /api/admin/system-health': () => 
      adminController.getSystemHealth(),
  };
}

/**
 * Database schema definitions
 * 
 * These can be used with Prisma, TypeORM, or other ORMs
 */
export const ContactDiscoverySchema = {
  // Contact privacy preferences table
  contactPrivacyPrefs: {
    userId: 'string (primary key)',
    allowDiscovery: 'boolean',
    discoveryMode: 'enum: mutual-only | one-sided | disabled',
    allowSuggestions: 'boolean',
    phoneDiscovery: 'boolean',
    emailDiscovery: 'boolean',
    createdAt: 'datetime',
    updatedAt: 'datetime',
  },

  // Discovery tokens for tracking mutual discoveries
  discoveryTokens: {
    id: 'string (primary key, UUID)',
    requesterId: 'string (foreign key to users)',
    targetId: 'string (foreign key to users)',
    contactHash: 'string (partial hash, first 8 chars)',
    platform: 'enum: phone | email',
    status: 'enum: pending | matched | expired',
    createdAt: 'datetime',
    expiresAt: 'datetime',
  },

  // Cleanup audit log
  cleanupAudit: {
    id: 'string (primary key, UUID)',
    tableName: 'string',
    deletedCount: 'integer',
    cleanupTimestamp: 'datetime',
  },

  // Emergency action log (for compliance)
  emergencyActions: {
    actionId: 'string (primary key, UUID)',
    actionType: 'enum: EMERGENCY_PURGE | DATA_BREACH_RESPONSE',
    reason: 'string',
    requestedBy: 'string',
    executedAt: 'datetime',
    affectedSystems: 'json array',
    status: 'enum: COMPLETED | FAILED | IN_PROGRESS',
    errorDetails: 'string (optional)',
  },

  // Retention compliance reports
  retentionReports: {
    id: 'string (primary key, UUID)',
    reportDate: 'date',
    contactHashesExpired: 'integer',
    discoveryTokensCleanedUp: 'integer',
    auditLogsRetained: 'integer',
    complianceStatus: 'enum: COMPLIANT | VIOLATION | UNKNOWN',
    createdAt: 'datetime',
  },
};

/**
 * Redis key patterns used by the contact discovery system
 */
export const RedisKeyPatterns = {
  contactHash: 'contact:{platform}:{hash}',
  userHashes: 'user_hashes:{userId}',
  contactExpiry: 'contact:expiry',
  rateLimitImport: 'rate_limit:contact_import:{userId}',
  rateLimitDiscovery: 'rate_limit:discovery:{userId}',
};

/**
 * Environment variables required for the contact discovery system
 */
export const RequiredEnvironmentVariables = {
  // Cryptographic salts (must be unique per environment)
  CONTACT_SALT_PHONE: 'Platform-specific salt for phone number hashing',
  CONTACT_SALT_EMAIL: 'Platform-specific salt for email hashing',
  CONTACT_USER_SALT_SECRET: 'Secret for generating user-specific salts',
  CONTACT_MONTHLY_SALT_SECRET: 'Secret for generating monthly rotating salts',
  
  // Redis configuration
  REDIS_URL: 'Redis connection string',
  REDIS_PASSWORD: 'Redis authentication password',
  
  // Database configuration
  DATABASE_URL: 'PostgreSQL connection string',
  
  // Rate limiting
  CONTACT_IMPORT_RATE_LIMIT: 'Max imports per hour per user (default: 10)',
  CONTACT_DISCOVERY_RATE_LIMIT: 'Max discovery requests per hour per user (default: 100)',
  
  // Data retention (optional overrides)
  CONTACT_HASH_TTL_DAYS: 'Contact hash retention period in days (default: 90)',
  DISCOVERY_TOKEN_TTL_DAYS: 'Discovery token retention period in days (default: 30)',
  AUDIT_LOG_TTL_DAYS: 'Audit log retention period in days (default: 365)',
};

/**
 * Security best practices checklist
 */
export const SecurityChecklist = [
  '✅ Use strong, unique salts for each environment',
  '✅ Rotate monthly salts regularly',
  '✅ Enable TLS 1.3 for all API communications',
  '✅ Implement request rate limiting',
  '✅ Enable Redis AUTH and encryption',
  '✅ Use connection pooling with timeouts',
  '✅ Implement comprehensive audit logging',
  '✅ Regular security audits and penetration testing',
  '✅ Monitor for unusual discovery patterns',
  '✅ Automated compliance reporting',
  '✅ Emergency data purge procedures',
  '✅ Staff training on privacy handling',
];

export default ContactImportModule;