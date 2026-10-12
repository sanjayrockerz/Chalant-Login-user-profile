import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Query,
  Request,
  UseGuards,
  HttpStatus,
  HttpCode,
  ValidationPipe,
  UsePipes,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request as ExpressRequest } from "express";
import { createHash } from "crypto";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
  ApiBearerAuth,
  ApiSecurity,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ContactsService } from "./contacts.service";
import { ContactsObservabilityService } from "./contacts-observability.service";
import {
  ContactUploadDto,
  ContactSuggestionResponseDto,
  ContactDeletionResponseDto,
  ContactUploadResponseDto,
  SuggestionQueryDto,
  PrivacyControlsDto,
  ContactIdentifierType,
} from "./dto/contacts.dto";
import {
  UploadContactsDto,
  UploadContactsResponseDto,
  SuggestionDto as UploadSuggestionDto,
  UploadContactsMetadataDto,
  UploadContactErrorDto,
  SuggestedUserSummaryDto,
  UploadSecurityReviewDto,
  UploadSecuritySignalDto,
} from "./dto/upload-contacts.dto";
import { MultiDimThrottleGuard } from "../security/multi_dim_throttle.guard";
import { RateLimit } from "../security/rate_limit.decorator";
import { HtmlSanitizerService } from "../security/html-sanitizer.service";
import { RequestWithPrincipal } from "../canonical-auth/canonical-auth.types";

type CanonicalContactsRequest = Omit<ExpressRequest, "user"> &
  RequestWithPrincipal;

function headerValue(
  request: CanonicalContactsRequest,
  name: string,
  fallback: string,
): string {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

/**
 * Contacts Upload and Friend Discovery API Controller
 *
 * Provides privacy-respecting contact upload functionality with friend suggestions.
 * All operations are optional and include clear skip paths for user privacy.
 *
 * Key Features:
 * - Optional contact upload with cryptographic hashing for privacy
 * - Intelligent friend suggestions with confidence scoring
 * - Complete data deletion and opt-out capabilities
 * - Comprehensive rate limiting and abuse prevention
 * - Feature flag-controlled rollout with A/B testing support
 * - Full observability with PII-free telemetry
 *
 * Privacy Design:
 * - Server-side hashing of contact identifiers
 * - No raw contact data stored or logged
 * - User-controlled data deletion and discovery opt-out
 * - Transparent privacy controls and explanations
 */
@ApiTags("contacts")
@Controller("contacts")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiSecurity("correlation-id")
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly observabilityService: ContactsObservabilityService,
    private readonly htmlSanitizer: HtmlSanitizerService,
  ) {}

  /**
   * Upload Contacts for Friend Discovery
   *
   * Authenticated users submit up to 500 phone numbers which are normalized,
   * hashed, persisted, and evaluated for friend matches. The response returns a
   * capped list of high-confidence suggestions along with processing metadata
   * and an optional cursor for pagination.
   */
  @Post("upload")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(MultiDimThrottleGuard)
  @RateLimit({
    user: { limit: 5, window: "1d" },
    ip: { limit: 100, window: "5m" },
    device: { limit: 20, window: "1d" },
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: "Upload phone contacts for friend discovery",
    description: `Upload a batch of phone numbers for normalization, hashing, and friend suggestion generation.

**Rate limits**
- 5 uploads per user per rolling 24 hours
- 100 contacts per 5 minutes per IP address
- 500 contacts maximum per request payload

**Privacy safeguards**
- Phone numbers are normalized and hashed server-side; raw values are never persisted.
- Hashed contacts expire automatically based on retention policy.
- The request correlation identifier is echoed for support traceability.
    `,
  })
  @ApiBody({
    type: UploadContactsDto,
    description: "Array of phone numbers to process",
    examples: {
      default: {
        summary: "Minimal upload",
        value: {
          phones: ["+14155551234", "+442071838750"],
          client_batch_id: "ios-device-42",
        },
      },
      large: {
        summary: "Bulk upload with mixed formatting",
        value: {
          phones: ["+1 (415) 555-1234", "0044 20 7946 0958", "+91-98765-43210"],
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: "Contacts accepted for processing with immediate suggestions",
    type: UploadContactsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      "DTO validation failed (array shape, item type, or basic formatting)",
    schema: {
      example: {
        statusCode: 400,
        message: [
          "phones must be provided as an array",
          "each phone number must resemble a valid international phone number",
        ],
        error: "Bad Request",
        correlation_id: "req-df8d5e50",
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: "All submitted phones failed normalization or hashing",
    schema: {
      example: {
        statusCode: 422,
        message: "No valid contacts were processed",
        error: "Unprocessable Entity",
        correlation_id: "req-df8d5e50",
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: "Rate limit exceeded for user, IP, or device",
    schema: {
      example: {
        statusCode: 429,
        message: "Rate limit exceeded",
        retry_after: 120,
        correlation_id: "req-df8d5e50",
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description:
      "Unexpected error during normalization, persistence, or suggestion generation",
    schema: {
      example: {
        statusCode: 500,
        message: "An unexpected error occurred",
        correlation_id: "req-df8d5e50",
      },
    },
  })
  async uploadContacts(
    @Body() uploadDto: UploadContactsDto,
    @Request() req: CanonicalContactsRequest,
  ): Promise<UploadContactsResponseDto> {
    const userId = this.requireSubject(req);
    const correlationId = headerValue(req, "x-correlation-id", "unknown");
    const tenantId = headerValue(req, "x-tenant-id", "default");
    const route = "/contacts/upload";
    const method = "POST";
    const startTime = Date.now();

    const legacyDto: ContactUploadDto = {
      contacts: uploadDto.phones.map((phone) => ({
        identifier: phone,
        type: ContactIdentifierType.PHONE,
      })),
      privacy_acknowledgment: true,
      data_retention_consent: true,
    };

    if (uploadDto.client_batch_id) {
      const sanitizedBatchId = this.htmlSanitizer
        .sanitizeToText(uploadDto.client_batch_id)
        .slice(0, 128);

      if (sanitizedBatchId.length > 0) {
        legacyDto.notes = sanitizedBatchId;
      }
    }

    const rawIp = req.ip || req.connection?.remoteAddress || "unknown";
    const rawDeviceId = headerValue(req, "x-device-id", "unknown-device");
    const userTier = "free" as const;
    const userAgent = headerValue(req, "user-agent", "unknown");
    const ipHash = this.createPrivacyHash(rawIp);
    const deviceHash = this.createPrivacyHash(rawDeviceId);

    const span = this.observabilityService.createTraceSpan(
      "contact_upload",
      correlationId,
      tenantId,
      userId,
    );

    try {
      const legacyResult = await this.contactsService.uploadContacts(
        userId,
        legacyDto,
        {
          correlationId,
          tenantId,
          userAgent,
          userTier,
          ipAddressHash: ipHash,
          deviceIdHash: deviceHash,
        },
      );

      const processingTime = Date.now() - startTime;
      const response = this.buildUploadContactsResponse(
        legacyResult,
        correlationId,
      );

      this.observabilityService.trackContactUpload({
        uploadId: legacyResult.upload_batch_id,
        userId,
        correlationId,
        tenantId,
        contactCount: uploadDto.phones.length,
        processingTimeMs: processingTime,
        success: true,
        validationFailures: legacyResult.processing_summary.validation_failures,
        duplicatesFound: legacyResult.processing_summary.duplicates_found,
        suggestionsGenerated: legacyResult.suggestions.length,
        userTier,
        abTestVariant: headerValue(req, "x-ab-variant", "default"),
      });

      this.observabilityService.trackApiPerformance(
        correlationId,
        tenantId,
        route,
        method,
        HttpStatus.ACCEPTED,
        processingTime,
        userTier,
      );

      if (legacyResult.security_review) {
        this.observabilityService.trackSecurityEvent({
          correlationId,
          tenantId,
          eventType: "suspicious_upload_pattern",
          severity: this.mapActionToSeverity(
            legacyResult.security_review.action,
          ),
          userAgent,
          ipAddress: rawIp,
          userId,
        });
      }

      span.finish(true, {
        uploadBatchId: legacyResult.upload_batch_id,
        contactCount: uploadDto.phones.length,
        suggestionsCount: legacyResult.suggestions.length,
      });

      return response;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const status =
        (error as { status?: number })?.status ??
        HttpStatus.INTERNAL_SERVER_ERROR;

      this.observabilityService.trackContactUpload({
        uploadId: "failed",
        userId,
        correlationId,
        tenantId,
        contactCount: uploadDto.phones.length,
        processingTimeMs: processingTime,
        success: false,
        errorType: error instanceof Error ? error.constructor.name : "unknown",
        validationFailures: 0,
        duplicatesFound: 0,
        suggestionsGenerated: 0,
        userTier,
        abTestVariant: headerValue(req, "x-ab-variant", "default"),
      });

      this.observabilityService.trackApiPerformance(
        correlationId,
        tenantId,
        route,
        method,
        status,
        processingTime,
        userTier,
      );

      span.finish(false, {
        errorType: error instanceof Error ? error.constructor.name : "unknown",
        errorMessage: error instanceof Error ? error.message : "unknown_error",
      });

      throw error;
    }
  }

  private buildUploadContactsResponse(
    legacy: ContactUploadResponseDto,
    correlationId: string,
  ): UploadContactsResponseDto {
    const allSuggestions = legacy.suggestions ?? [];
    const topSuggestions = allSuggestions.slice(0, 20);

    const suggestions: UploadSuggestionDto[] = topSuggestions.map(
      (suggestion) => {
        const viewedAt = (suggestion as unknown as { viewed_at?: string })
          .viewed_at;
        const suggestedUser = Object.assign(new SuggestedUserSummaryDto(), {
          id: suggestion.user_id,
          display_name: suggestion.display_name,
          profile_image_url: suggestion.profile_picture_url ?? null,
        });

        return Object.assign(new UploadSuggestionDto(), {
          suggested_user: suggestedUser,
          match_type: suggestion.match_type,
          match_strength: suggestion.confidence_score,
          created_at: suggestion.discovered_at,
          is_new: !viewedAt,
        });
      },
    );

    const metadata = Object.assign(new UploadContactsMetadataDto(), {
      total_uploaded: legacy.processing_summary.total_processed,
      duplicates_skipped: legacy.processing_summary.duplicates_found,
      invalid_phones: legacy.processing_summary.validation_failures,
      new_hashes_stored: Math.max(
        legacy.processing_summary.total_processed -
          legacy.processing_summary.validation_failures -
          legacy.processing_summary.duplicates_found,
        0,
      ),
      suggestions_generated: topSuggestions.length,
    });

    const response = Object.assign(new UploadContactsResponseDto(), {
      success: true,
      suggestions,
      metadata,
      correlation_id: correlationId,
    });

    if (legacy.pagination?.has_next) {
      response.next_cursor = `page=${legacy.pagination.page + 1}&limit=${legacy.pagination.limit}`;
    }

    if (legacy.invalid_identifiers?.length) {
      response.errors = legacy.invalid_identifiers.map((phone) =>
        Object.assign(new UploadContactErrorDto(), {
          phone,
          reason: "Invalid format",
        }),
      );
    }

    if (legacy.security_review) {
      const review = Object.assign(new UploadSecurityReviewDto(), {
        action: legacy.security_review.action,
        cooldown_seconds: legacy.security_review.cooldown_seconds,
        signals: (legacy.security_review.signals ?? []).map((signal) =>
          Object.assign(new UploadSecuritySignalDto(), {
            type: signal.type,
            severity: signal.severity,
            message: signal.message,
          }),
        ),
      });

      response.security_review = review;

      if (legacy.security_review.action === "challenge") {
        response.suggestions = [];
        response.metadata.suggestions_generated = 0;
      }
    }

    return response;
  }

  private createPrivacyHash(value: string): string {
    return createHash("sha256")
      .update(value ?? "unknown")
      .digest("hex");
  }

  private mapActionToSeverity(
    action: "allow" | "monitor" | "challenge" | "block",
  ): "low" | "medium" | "high" | "critical" {
    switch (action) {
      case "block":
        return "critical";
      case "challenge":
        return "high";
      case "monitor":
        return "medium";
      default:
        return "low";
    }
  }

  /**
   * Get Friend Suggestions
   *
   * Retrieve friend suggestions based on previously uploaded contacts.
   * Results are ranked by match strength, mutual connections, and recency.
   * Supports filtering and pagination for optimal user experience.
   *
   * Rate Limits:
   * - 100 requests per hour per user
   * - Results cached for 15 minutes to improve performance
   */
  @Get("suggestions")
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: "Get friend suggestions from uploaded contacts",
    description: `
    Retrieve friend suggestions based on mutual contact discovery.
    
    **Ranking Algorithm:**
    - Mutual contacts ranked highest (both users have each other)
    - One-sided matches ranked by confidence score
    - Recent uploads weighted higher than older ones
    - Active users prioritized over inactive accounts
    
    **Privacy Filters:**
    - Excludes blocked users and privacy-restricted accounts
    - Respects users who have opted out of discovery
    - Filters by user privacy settings and preferences
    
    **Pagination:**
    Results are paginated to improve performance and user experience.
    Use page and limit parameters to navigate through suggestions.
    `,
  })
  @ApiQuery({
    name: "match_type",
    required: false,
    enum: ["mutual", "one_sided", "all"],
    description: "Filter suggestions by match type",
    example: "mutual",
  })
  @ApiQuery({
    name: "min_confidence",
    required: false,
    type: Number,
    description: "Minimum confidence score (0.0 to 1.0)",
    example: 0.7,
  })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    description: "Page number for pagination (1-based)",
    example: 1,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Number of suggestions per page (max 50)",
    example: 20,
  })
  @ApiQuery({
    name: "since",
    required: false,
    type: String,
    description: "ISO timestamp to filter suggestions newer than this date",
    example: "2024-01-01T00:00:00Z",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Friend suggestions retrieved successfully",
    type: ContactSuggestionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "No uploaded contacts found for user",
    schema: {
      example: {
        statusCode: 404,
        message:
          "No contacts uploaded. Upload contacts first to see suggestions.",
        error: "Not Found",
        correlationId: "req_123456789",
      },
    },
  })
  async getSuggestions(
    @Query() query: SuggestionQueryDto,
    @Request() req: CanonicalContactsRequest,
  ): Promise<ContactSuggestionResponseDto> {
    const userId = this.requireSubject(req);
    const correlationId = headerValue(req, "x-correlation-id", "unknown");
    const tenantId = headerValue(req, "x-tenant-id", "default");

    return this.contactsService.getSuggestions(userId, query, {
      correlationId,
      tenantId,
    });
  }

  /**
   * Delete Uploaded Contacts and Opt Out
   *
   * Permanently delete all uploaded contact data and opt out of future discovery.
   * This action cannot be undone and will remove all friend suggestions.
   * Users can re-enable contact discovery later by uploading new contacts.
   *
   * Rate Limits:
   * - 5 deletions per hour per user (prevents accidental rapid deletions)
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: "Delete all uploaded contacts and opt out of discovery",
    description: `
    Permanently delete all uploaded contact data and opt out of discovery.
    
    **What This Does:**
    - Permanently deletes all hashed contact identifiers
    - Removes you from other users' friend suggestions
    - Clears all your friend suggestions from contacts
    - Opts you out of future contact-based discovery
    
    **Important Notes:**
    - This action cannot be undone
    - You can re-enable contact discovery later by uploading new contacts
    - Other platform features are not affected
    - Your account and profile remain active
    
    **Privacy Compliance:**
    - Fulfills data deletion requests per GDPR/CCPA
    - Complete removal within 30 days (immediate from active systems)
    - Audit trail maintained for compliance (no contact data)
    `,
  })
  @ApiBody({
    type: PrivacyControlsDto,
    description: "Deletion confirmation and privacy control options",
    examples: {
      "complete-deletion": {
        summary: "Delete all contacts and opt out",
        value: {
          confirm_deletion: true,
          opt_out_of_discovery: true,
          deletion_reason: "privacy_preference",
        },
      },
      "temporary-opt-out": {
        summary: "Keep contacts but opt out of discovery",
        value: {
          confirm_deletion: false,
          opt_out_of_discovery: true,
          deletion_reason: "temporary_privacy",
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Contacts deleted successfully",
    type: ContactDeletionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "No contacts found to delete",
    schema: {
      example: {
        statusCode: 404,
        message: "No uploaded contacts found for deletion.",
        error: "Not Found",
        correlationId: "req_123456789",
      },
    },
  })
  async deleteContacts(
    @Body() deletionDto: PrivacyControlsDto,
    @Request() req: CanonicalContactsRequest,
  ): Promise<ContactDeletionResponseDto> {
    const userId = this.requireSubject(req);
    const correlationId = headerValue(req, "x-correlation-id", "unknown");
    const tenantId = headerValue(req, "x-tenant-id", "default");

    return this.contactsService.deleteContacts(userId, deletionDto, {
      correlationId,
      tenantId,
    });
  }

  /**
   * Get Privacy Controls and Data Summary
   *
   * Retrieve current privacy settings and data summary for transparency.
   * Shows what contact data is stored, when it was uploaded, and privacy controls.
   */
  @Get("privacy")
  @ApiOperation({
    summary: "Get privacy controls and data summary",
    description: `
    View your current contact privacy settings and data summary.
    
    **Transparency Features:**
    - Shows how many contacts are stored (no identifiers)
    - Displays upload dates and retention timeline
    - Lists current privacy settings and discovery status
    - Provides links to privacy policy and deletion options
    `,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Privacy controls retrieved successfully",
    schema: {
      example: {
        privacy_settings: {
          discovery_enabled: true,
          discovery_opted_out: false,
          mutual_discovery_only: false,
        },
        data_summary: {
          contacts_stored: 150,
          upload_date: "2024-01-15T10:30:00Z",
          retention_expires: "2024-04-15T10:30:00Z",
          last_suggestion_update: "2024-01-16T08:00:00Z",
        },
        controls: {
          can_delete_contacts: true,
          can_opt_out_discovery: true,
          can_adjust_privacy_settings: true,
        },
        links: {
          privacy_policy: "/privacy",
          delete_contacts: "/contacts",
          privacy_settings: "/settings/privacy",
        },
      },
    },
  })
  getPrivacyControls(
    @Request() req: CanonicalContactsRequest,
  ): Promise<unknown> {
    const userId = this.requireSubject(req);
    const correlationId = headerValue(req, "x-correlation-id", "unknown");
    const tenantId = headerValue(req, "x-tenant-id", "default");

    return this.contactsService.getPrivacyControls(userId, {
      correlationId,
      tenantId,
    });
  }

  private requireSubject(request: CanonicalContactsRequest): string {
    if (!request.user?.subject) {
      throw new UnauthorizedException("Canonical authentication required");
    }
    return request.user.subject;
  }
}
