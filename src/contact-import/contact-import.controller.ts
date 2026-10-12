import { ContactImportService, ContactImportDto, ContactDiscoveryPreferencesDto } from './secure-contact-import.service';

/**
 * Contact Import Controller
 * 
 * Provides REST API endpoints for secure contact discovery functionality
 * with comprehensive privacy controls and transparent data handling.
 */
export class ContactImportController {
  constructor(private readonly contactImportService: ContactImportService) {}

  /**
   * Import contacts and discover friends
   * 
   * POST /api/contacts/import
   * 
   * @param userId - Authenticated user ID
   * @param body - Contact import data
   * @returns Discovery results with privacy protection
   */
  async importContacts(userId: string, body: ContactImportDto) {
    try {
      const result = await this.contactImportService.importContacts(userId, body);
      
      return {
        success: true,
        data: result,
        message: `Imported ${result.importedCount} contacts, discovered ${result.discoveredCount} friends`,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get user's discovery preferences
   * 
   * GET /api/contacts/preferences
   * 
   * @param userId - Authenticated user ID
   * @returns Current privacy preferences
   */
  async getDiscoveryPreferences(userId: string) {
    try {
      const preferences = await this.contactImportService.getDiscoveryPreferences(userId);
      
      return {
        success: true,
        data: preferences,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Update discovery preferences
   * 
   * PUT /api/contacts/preferences
   * 
   * @param userId - Authenticated user ID
   * @param body - Updated preferences
   * @returns Updated preferences
   */
  async updateDiscoveryPreferences(userId: string, body: ContactDiscoveryPreferencesDto) {
    try {
      const updated = await this.contactImportService.updateDiscoveryPreferences(userId, body);
      
      return {
        success: true,
        data: updated,
        message: 'Discovery preferences updated successfully',
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get discovery history
   * 
   * GET /api/contacts/discoveries
   * 
   * @param userId - Authenticated user ID
   * @returns List of recent discoveries (privacy-safe)
   */
  async getDiscoveryHistory(userId: string) {
    try {
      const history = await this.contactImportService.getDiscoveryHistory(userId);
      
      return {
        success: true,
        data: history,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Delete all contact data
   * 
   * DELETE /api/contacts/data
   * 
   * @param userId - Authenticated user ID
   * @returns Deletion confirmation
   */
  async deleteContactData(userId: string) {
    try {
      await this.contactImportService.deleteUserContactData(userId);
      
      return {
        success: true,
        message: 'All contact discovery data has been permanently deleted',
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Privacy-safe error handling
   */
  private handleError(error: any) {
    // Log error details for debugging (with PII redaction)
    console.error('Contact discovery error:', {
      name: error.name,
      message: this.redactPII(error.message),
      timestamp: new Date(),
    });

    // Return sanitized error to client
    if (error.name === 'BadRequestException') {
      return {
        success: false,
        error: 'INVALID_INPUT',
        message: 'Invalid contact data provided',
        statusCode: 400,
      };
    }

    if (error.name === 'ForbiddenException') {
      return {
        success: false,
        error: 'DISCOVERY_DISABLED',
        message: 'Contact discovery is not enabled for your account',
        statusCode: 403,
      };
    }

    // Generic error for security
    return {
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'An error occurred while processing your request',
      statusCode: 500,
    };
  }

  /**
   * Redact PII from error messages
   */
  private redactPII(message: string): string {
    if (!message) return message;
    
    return message
      .replace(/[\w._%+-]+@[\w.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]')
      .replace(/\+?[\d\s\-\(\)]{10,}/g, '[PHONE_REDACTED]')
      .replace(/[a-fA-F0-9]{32,}/g, '[HASH_REDACTED]');
  }
}

/**
 * Contact Privacy Controller
 * 
 * Dedicated controller for privacy-related operations including
 * data export, deletion requests, and transparency reporting.
 */
export class ContactPrivacyController {
  constructor(private readonly contactImportService: ContactImportService) {}

  /**
   * Export user's contact discovery data (GDPR/CCPA compliance)
   * 
   * GET /api/privacy/contact-data-export
   * 
   * @param userId - Authenticated user ID
   * @returns Privacy-compliant data export
   */
  async exportContactData(userId: string) {
    try {
      const [preferences, history] = await Promise.all([
        this.contactImportService.getDiscoveryPreferences(userId),
        this.contactImportService.getDiscoveryHistory(userId),
      ]);

      const exportData = {
        userId,
        exportDate: new Date().toISOString(),
        dataTypes: {
          privacyPreferences: preferences,
          discoveryHistory: history.map(item => ({
            ...item,
            // Remove any potential identifying information
            id: item.id.substring(0, 8) + '...',
          })),
        },
        dataRetention: {
          contactHashes: '90 days (automatically deleted)',
          discoveryTokens: '7-30 days (automatically deleted)',
          privacyPreferences: 'Until account deletion',
          auditLogs: '1 year (anonymized)',
        },
        privacyNotes: [
          'Raw contact information is never stored on our servers',
          'Only irreversible cryptographic hashes are processed',
          'Discovery requires mutual consent in most-private mode',
          'All data expires automatically according to retention policy',
        ],
      };

      return {
        success: true,
        data: exportData,
        contentType: 'application/json',
        filename: `contact-discovery-data-${userId.substring(0, 8)}-${new Date().toISOString().split('T')[0]}.json`,
      };
    } catch (error) {
      console.error('Data export error:', error);
      return {
        success: false,
        error: 'EXPORT_FAILED',
        message: 'Unable to export data at this time',
        statusCode: 500,
      };
    }
  }

  /**
   * Request immediate data deletion (GDPR/CCPA compliance)
   * 
   * POST /api/privacy/delete-contact-data
   * 
   * @param userId - Authenticated user ID
   * @returns Deletion confirmation
   */
  async requestDataDeletion(userId: string) {
    try {
      await this.contactImportService.deleteUserContactData(userId);

      return {
        success: true,
        message: 'Your contact discovery data has been permanently deleted',
        deletionTimestamp: new Date().toISOString(),
        dataTypesDeleted: [
          'Contact hashes',
          'Discovery tokens',
          'Privacy preferences',
        ],
        note: 'This action cannot be undone. You will need to re-import contacts to use discovery features.',
      };
    } catch (error) {
      console.error('Data deletion error:', error);
      return {
        success: false,
        error: 'DELETION_FAILED',
        message: 'Unable to delete data at this time. Please contact support.',
        statusCode: 500,
      };
    }
  }

  /**
   * Get privacy transparency report
   * 
   * GET /api/privacy/transparency-report
   * 
   * @param userId - Authenticated user ID
   * @returns Transparency information about data handling
   */
  async getTransparencyReport(userId: string) {
    try {
      const preferences = await this.contactImportService.getDiscoveryPreferences(userId);
      const history = await this.contactImportService.getDiscoveryHistory(userId);

      return {
        success: true,
        data: {
          userId: userId.substring(0, 8) + '...',
          reportDate: new Date().toISOString(),
          privacyStatus: {
            discoveryEnabled: preferences.allowDiscovery,
            discoveryMode: preferences.discoveryMode,
            suggestionsEnabled: preferences.allowSuggestions,
            phoneDiscoveryEnabled: preferences.phoneDiscovery,
            emailDiscoveryEnabled: preferences.emailDiscovery,
          },
          dataProcessing: {
            contactHashesStored: 'Yes (encrypted, expires in 90 days)',
            rawContactsStored: 'No (never stored)',
            crossPlatformTracking: 'No (separate hashing per platform)',
            thirdPartySharing: 'No (never shared)',
          },
          userRights: {
            dataAccess: 'Available via data export',
            dataCorrection: 'Available via preference updates',
            dataDeletion: 'Available via delete request',
            dataPortability: 'Available via data export',
            optOut: 'Available via privacy preferences',
          },
          discoveryActivity: {
            totalDiscoveries: history.length,
            lastDiscovery: history[0]?.discoveredAt || null,
            mutualDiscoveryOnly: preferences.discoveryMode === 'mutual-only',
          },
          securityMeasures: [
            'Argon2id cryptographic hashing (simulated with PBKDF2)',
            'Multi-layer salt protection',
            'Automatic data expiration',
            'PII redaction in all logs',
            'Encrypted data transmission',
            'Mutual consent requirements',
          ],
        },
      };
    } catch (error) {
      console.error('Transparency report error:', error);
      return {
        success: false,
        error: 'REPORT_FAILED',
        message: 'Unable to generate transparency report at this time',
        statusCode: 500,
      };
    }
  }
}

/**
 * Admin Controller for contact discovery system monitoring
 * 
 * Provides endpoints for system administrators to monitor
 * the health and compliance of the contact discovery system.
 */
export class ContactAdminController {
  constructor(private readonly contactImportService: ContactImportService) {}

  /**
   * Trigger manual cleanup of expired data
   * 
   * POST /api/admin/cleanup-expired-data
   * 
   * @returns Cleanup results
   */
  async triggerCleanup() {
    try {
      const result = await this.contactImportService.cleanupExpiredData();
      
      return {
        success: true,
        data: result,
        message: `Cleaned up ${result.cleaned} expired records`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Cleanup error:', error);
      return {
        success: false,
        error: 'CLEANUP_FAILED',
        message: 'Failed to perform cleanup operation',
        statusCode: 500,
      };
    }
  }

  /**
   * Get system health metrics (anonymized)
   * 
   * GET /api/admin/system-health
   * 
   * @returns Anonymized system metrics
   */
  async getSystemHealth() {
    // This would integrate with actual monitoring systems
    // For now, return mock health data
    return {
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        status: 'healthy',
        metrics: {
          totalActiveUsers: '~N thousand (anonymized)',
          dailyImports: '~N hundred (anonymized)',
          discoverySuccessRate: '~85% (anonymized)',
          averageResponseTime: '~150ms',
        },
        compliance: {
          dataRetentionCompliant: true,
          piiRedactionActive: true,
          automaticCleanupOperational: true,
          lastCleanupRun: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
        privacy: {
          mutualOnlyModeAdoption: '~75% (anonymized)',
          discoveryOptInRate: '~60% (anonymized)',
          dataExportRequests: '~N per month (anonymized)',
          dataDeletionRequests: '~N per month (anonymized)',
        },
      },
    };
  }
}