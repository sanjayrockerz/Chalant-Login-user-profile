import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { Counter, Histogram, register } from "prom-client";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import {
  ContactUploadDto,
  ContactUploadResponseDto,
  ContactSuggestionResponseDto,
  ContactDeletionResponseDto,
  SuggestionQueryDto,
  PrivacyControlsDto,
  ContactIdentifierType,
} from "./dto/contacts.dto";
import {
  PHONE_HASHING_PORT,
  PHONE_NORMALIZATION_PORT,
  PhoneHashingPort,
  PhoneNormalizationPort,
} from "./contacts.tokens";
import { ContactsRepository, DeletionResult } from "./contacts.repository";
import { ContactMatchingService } from "./contact-matching.service";
import { ContactSuggestionService } from "./contact-suggestion.service";
import {
  ContactsAnomalyService,
  AnomalyAssessment,
} from "./contacts-anomaly.service";
import {
  ContactUploadFailedException,
  InvalidPhoneException,
  RateLimitExceededException,
  AnomalousContactUploadException,
} from "./exceptions/contact.exceptions";
import {
  NormalizedContact,
  NormalizationResult,
  PrismaTransactionClient,
  PersistedContactRecord,
  RequestContext,
} from "./contacts.types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const uploadAttemptsCounter =
  (register.getSingleMetric("contacts_upload_pipeline_total") as
    | Counter<"status">
    | undefined) ??
  new Counter<"status">({
    name: "contacts_upload_pipeline_total",
    help: "Total number of contact upload pipeline executions",
    labelNames: ["status"],
    registers: [register],
  });

const uploadPhaseHistogram =
  (register.getSingleMetric("contacts_upload_phase_duration_seconds") as
    | Histogram<"phase">
    | undefined) ??
  new Histogram<"phase">({
    name: "contacts_upload_phase_duration_seconds",
    help: "Duration of contact upload pipeline phases in seconds",
    labelNames: ["phase"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register],
  });

interface PrivacyOverviewResponse {
  privacy_settings: {
    discovery_enabled: boolean;
    discovery_opted_out: boolean;
    mutual_discovery_only: boolean;
  };
  data_summary: {
    contacts_stored: number;
    upload_date: string | null;
    retention_expires: string | null;
    last_suggestion_update: string | null;
  };
  controls: {
    can_delete_contacts: boolean;
    can_opt_out_discovery: boolean;
    can_adjust_privacy_settings: boolean;
  };
  links: {
    privacy_policy: string;
    delete_contacts: string;
    privacy_settings: string;
  };
}

interface UploadSummary {
  withinBatchDuplicates: number;
  crossBatchDuplicates: number;
  newHashesStored: number;
  retentionDays: number;
  persisted: PersistedContactRecord[];
  suggestions: ContactSuggestionResponseDto | null;
  durations: {
    dedupeMs: number;
    storeMs: number;
  };
}

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly repository: ContactsRepository,
    private readonly matchingService: ContactMatchingService,
    private readonly suggestionService: ContactSuggestionService,
    @Inject(PHONE_NORMALIZATION_PORT)
    private readonly phoneNormalization: PhoneNormalizationPort,
    @Inject(PHONE_HASHING_PORT)
    private readonly phoneHashing: PhoneHashingPort,
    @Optional() private readonly anomalyService?: ContactsAnomalyService,
  ) {}

  async uploadContacts(
    userId: string,
    dto: ContactUploadDto,
    context: RequestContext,
  ): Promise<ContactUploadResponseDto> {
    this.assertSecureDiscoveryEnabled();
    const startTime = Date.now();
    this.logger.debug("contacts.upload:start", {
      userId,
      contactCount: dto.contacts.length,
      ...this.withContext(context),
    });

    this.guardRateLimits(dto, context);
    this.ensurePrivacyConsent(dto, context);

    const normalizationStart = Date.now();
    const normalization = await this.normalizeContacts(dto.contacts, context);
    const normalizationDuration = Date.now() - normalizationStart;

    if (normalization.uniqueContacts.length === 0) {
      this.logger.warn("contacts.upload:no_valid_contacts", {
        userId,
        invalidCount: normalization.invalidIdentifiers.length,
        ...this.withContext(context),
      });
      throw new InvalidPhoneException(
        "no_valid_contacts",
        context.correlationId,
      );
    }

    const summary: UploadSummary = {
      withinBatchDuplicates: normalization.withinBatchDuplicates,
      crossBatchDuplicates: 0,
      newHashesStored: 0,
      retentionDays: this.resolveNumberConfig("CONTACT_HASH_TTL_DAYS", 30),
      persisted: [] as PersistedContactRecord[],
      suggestions: null as ContactSuggestionResponseDto | null,
      durations: {
        dedupeMs: 0,
        storeMs: 0,
      },
    };

    try {
      summary.suggestions = await this.prisma.$transaction(
        async (tx: PrismaTransactionClient) => {
          const uniqueHashes = normalization.uniqueContacts.map(
            (contact) => contact.hash,
          );
          const dedupeStart = Date.now();
          const existingDuplicates = await this.repository.countExistingHashes(
            tx,
            userId,
            uniqueHashes,
          );
          summary.durations.dedupeMs = Date.now() - dedupeStart;

          existingDuplicates.forEach((hash) =>
            normalization.duplicateHashes.add(hash),
          );

          const contactsToPersist = normalization.uniqueContacts.filter(
            (contact) => !existingDuplicates.has(contact.hash),
          );
          summary.crossBatchDuplicates =
            normalization.uniqueContacts.length - contactsToPersist.length;

          if (contactsToPersist.length === 0) {
            return this.buildEmptySuggestionResponse();
          }

          const storeStart = Date.now();
          summary.persisted = await this.repository.insertHashedContacts(
            tx,
            userId,
            contactsToPersist,
            summary.retentionDays,
          );
          summary.durations.storeMs = Date.now() - storeStart;
          summary.newHashesStored = summary.persisted.length;

          if (summary.persisted.length > 0) {
            await tx.user.update({
              where: { id: userId },
              data: { allowContactDiscovery: true },
            });
          }

          if (summary.persisted.length === 0) {
            return this.buildEmptySuggestionResponse();
          }

          const matches = await this.matchingService.matchContacts(tx, {
            userId,
            contacts: summary.persisted,
            context,
          });

          return this.suggestionService.generateSuggestions(tx, {
            userId,
            matches,
            context,
          });
        },
      );

      const totalDuplicates =
        summary.withinBatchDuplicates + summary.crossBatchDuplicates;
      const suggestions =
        summary.suggestions ?? this.buildEmptySuggestionResponse();
      const response = this.buildUploadResponse({
        dto,
        normalization,
        retentionDays: summary.retentionDays,
        persisted: summary.persisted,
        suggestions,
        duplicateCount: totalDuplicates,
      });

      const totalDuration = Date.now() - startTime;

      this.emitUploadTelemetry({
        userId,
        context,
        dto,
        normalization,
        summary,
        totalDuplicates,
        normalizationDuration,
        totalDuration,
      });

      const anomalyAssessment: AnomalyAssessment = this.anomalyService
        ? await this.anomalyService.assess({
            userIdHash: this.createPrivacyHash(userId),
            ipHash:
              context.ipAddressHash ?? this.createPrivacyHash("ip:unknown"),
            deviceIdHash:
              context.deviceIdHash ?? this.createPrivacyHash("device:unknown"),
            uploadDto: dto,
            normalization,
            context,
            duplicateCount: totalDuplicates,
            newHashes: summary.newHashesStored,
            processingTimeMs: totalDuration,
          })
        : { action: "allow", signals: [] };

      this.applyAnomalyAssessment({
        assessment: anomalyAssessment,
        legacyResult: response,
        correlationId: context.correlationId,
        summary,
      });

      return response;
    } catch (error) {
      this.logger.error(
        `contacts.upload:failed user=${userId}`,
        error instanceof Error ? error.stack : undefined,
        this.withContext(context),
      );

      if (error instanceof InvalidPhoneException) {
        throw error;
      }

      throw new ContactUploadFailedException(
        error instanceof Error ? error.message : "unknown_error",
        context.correlationId,
      );
    }
  }

  async getSuggestions(
    userId: string,
    query: SuggestionQueryDto,
    context: RequestContext,
  ): Promise<ContactSuggestionResponseDto> {
    this.assertSecureDiscoveryEnabled();
    return this.prisma.$transaction((tx) =>
      this.suggestionService.listSuggestions(tx, {
        userId,
        query,
        context,
      }),
    );
  }

  async deleteContacts(
    userId: string,
    body: PrivacyControlsDto,
    context: RequestContext,
  ): Promise<ContactDeletionResponseDto> {
    if (!body.confirm_deletion) {
      throw new ContactUploadFailedException(
        "deletion_not_confirmed",
        context.correlationId,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const deletion = await this.repository.deleteContacts(
        tx,
        userId,
        body.opt_out_of_discovery ?? false,
      );
      await this.suggestionService.markSuggestionsStale(tx, userId, context);
      await tx.user.update({
        where: { id: userId },
        data: { allowContactDiscovery: !(body.opt_out_of_discovery ?? false) },
      });
      return this.buildDeletionResponse(deletion);
    });
  }

  async getPrivacyControls(
    userId: string,
    context: RequestContext,
  ): Promise<PrivacyOverviewResponse> {
    const [storedContacts, user] = await this.prisma.$transaction(async (tx) =>
      Promise.all([
        this.repository.getStoredContacts(tx, userId),
        tx.user.findUnique({
          where: { id: userId },
          select: { allowContactDiscovery: true },
        }),
      ]),
    );

    const hasContacts = storedContacts.length > 0;
    const latestSeen = hasContacts
      ? storedContacts.reduce(
          (latest, record) =>
            record.lastSeenAt > latest ? record.lastSeenAt : latest,
          storedContacts[0].lastSeenAt,
        )
      : null;
    const retentionExpires = hasContacts
      ? storedContacts.reduce(
          (latest, record) =>
            record.expiresAt > latest ? record.expiresAt : latest,
          storedContacts[0].expiresAt,
        )
      : null;

    this.logger.debug("contacts.privacy:overview", {
      userId,
      contactCount: storedContacts.length,
      ...this.withContext(context),
    });

    return {
      privacy_settings: {
        discovery_enabled: user?.allowContactDiscovery ?? false,
        discovery_opted_out: !(user?.allowContactDiscovery ?? false),
        mutual_discovery_only: false,
      },
      data_summary: {
        contacts_stored: storedContacts.length,
        upload_date: latestSeen ? latestSeen.toISOString() : null,
        retention_expires: retentionExpires
          ? retentionExpires.toISOString()
          : null,
        last_suggestion_update: latestSeen ? latestSeen.toISOString() : null,
      },
      controls: {
        can_delete_contacts: hasContacts,
        can_opt_out_discovery: true,
        can_adjust_privacy_settings: true,
      },
      links: {
        privacy_policy: "/privacy",
        delete_contacts: "/contacts",
        privacy_settings: "/settings/privacy",
      },
    };
  }

  private assertSecureDiscoveryEnabled(): void {
    if (this.configService.get("CONTACT_HASH_MODE") !== "hmac-sha256-v2") {
      throw new ServiceUnavailableException(
        "Contact discovery is unavailable until HMAC contact hashing is provisioned",
      );
    }
  }

  private emitUploadTelemetry(params: {
    userId: string;
    context: RequestContext;
    dto: ContactUploadDto;
    normalization: NormalizationResult;
    summary: UploadSummary;
    totalDuplicates: number;
    normalizationDuration: number;
    totalDuration: number;
  }): void {
    const {
      userId,
      context,
      dto,
      normalization,
      summary,
      totalDuplicates,
      normalizationDuration,
      totalDuration,
    } = params;

    try {
      uploadAttemptsCounter.labels("success").inc();
      uploadPhaseHistogram
        .labels("normalize")
        .observe(normalizationDuration / 1000);
      uploadPhaseHistogram
        .labels("dedupe")
        .observe(summary.durations.dedupeMs / 1000);
      uploadPhaseHistogram
        .labels("store")
        .observe(summary.durations.storeMs / 1000);
      uploadPhaseHistogram.labels("total").observe(totalDuration / 1000);
    } catch (metricError) {
      this.logger.debug("contacts.upload:metrics_error", {
        error:
          metricError instanceof Error ? metricError.message : "unknown_error",
        ...this.withContext(context),
      });
    }

    this.logger.log("contacts.uploaded", {
      userId,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      totalUploaded: dto.contacts.length,
      invalidCount: normalization.invalidIdentifiers.length,
      duplicateCount: totalDuplicates,
      withinBatchDuplicates: summary.withinBatchDuplicates,
      crossBatchDuplicates: summary.crossBatchDuplicates,
      newHashesStored: summary.newHashesStored,
      retentionDays: summary.retentionDays,
      normalizationDurationMs: normalizationDuration,
      dedupeDurationMs: summary.durations.dedupeMs,
      storageDurationMs: summary.durations.storeMs,
      totalDurationMs: totalDuration,
      component: "contacts-service",
      event: "contacts.uploaded",
    });
  }

  private guardRateLimits(
    dto: ContactUploadDto,
    context: RequestContext,
  ): void {
    const maxContacts = this.resolveNumberConfig("CONTACT_UPLOAD_MAX", 1000);
    if (dto.contacts.length > maxContacts) {
      this.logger.warn("contacts.upload:rate_limit_exceeded", {
        size: dto.contacts.length,
        maxContacts,
        ...this.withContext(context),
      });
      throw new RateLimitExceededException(context.correlationId);
    }
  }

  private ensurePrivacyConsent(
    dto: ContactUploadDto,
    context: RequestContext,
  ): void {
    if (!dto.privacy_acknowledgment || !dto.data_retention_consent) {
      throw new ContactUploadFailedException(
        "privacy_consent_required",
        context.correlationId,
      );
    }
  }

  private async normalizeContacts(
    contacts: ContactUploadDto["contacts"],
    context: RequestContext,
  ): Promise<NormalizationResult> {
    const unique = new Map<string, NormalizedContact>();
    const invalidIdentifiers: string[] = [];
    const invalidDetails: Array<{ identifier: string; reason: string }> = [];
    const duplicateHashes = new Set<string>();
    const typeBreakdown: Record<ContactIdentifierType, number> = {
      [ContactIdentifierType.PHONE]: 0,
      [ContactIdentifierType.EMAIL]: 0,
    };
    let withinBatchDuplicates = 0;

    for (const contact of contacts) {
      try {
        let normalizedValue: string;

        if (contact.type === ContactIdentifierType.PHONE) {
          normalizedValue = await this.normalizePhone(
            contact.identifier,
            context,
          );
        } else if (contact.type === ContactIdentifierType.EMAIL) {
          normalizedValue = this.normalizeEmail(contact.identifier);
        } else {
          throw new Error("unsupported_identifier_type");
        }

        const hash = this.hashIdentifier(normalizedValue);

        if (unique.has(hash)) {
          duplicateHashes.add(hash);
          withinBatchDuplicates += 1;
          continue;
        }

        unique.set(hash, {
          originalIdentifier: contact.identifier,
          type: contact.type,
          normalizedValue,
          hash,
        });

        typeBreakdown[contact.type] = (typeBreakdown[contact.type] ?? 0) + 1;
      } catch (error) {
        const reason =
          error instanceof InvalidPhoneException
            ? "Invalid format"
            : error instanceof Error && error.message
              ? error.message
              : "unknown";

        invalidIdentifiers.push(contact.identifier);
        invalidDetails.push({ identifier: contact.identifier, reason });

        this.logger.debug("contacts.normalize:skip", {
          identifier: contact.identifier,
          reason,
          ...this.withContext(context),
        });
      }
    }

    return {
      uniqueContacts: [...unique.values()],
      invalidIdentifiers,
      invalidDetails,
      duplicateHashes,
      typeBreakdown,
      withinBatchDuplicates,
    };
  }

  private async normalizePhone(
    identifier: string,
    context: RequestContext,
  ): Promise<string> {
    try {
      const normalized = await this.phoneNormalization.normalize(identifier);
      if (!normalized?.e164) {
        throw new Error("missing_e164");
      }
      return normalized.e164;
    } catch {
      this.logger.warn("contacts.normalize:phone_failed", {
        identifier,
        ...this.withContext(context),
      });
      throw new InvalidPhoneException(identifier, context.correlationId);
    }
  }

  private normalizeEmail(identifier: string): string {
    const email = identifier.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      throw new Error("invalid_email");
    }
    return email;
  }

  private hashIdentifier(value: string): string {
    return this.phoneHashing.hash(value);
  }

  private buildUploadResponse(params: {
    dto: ContactUploadDto;
    normalization: NormalizationResult;
    retentionDays: number;
    persisted: PersistedContactRecord[];
    suggestions: ContactSuggestionResponseDto;
    duplicateCount: number;
  }): ContactUploadResponseDto {
    const {
      dto,
      normalization,
      retentionDays,
      persisted,
      suggestions,
      duplicateCount,
    } = params;
    const processedAt = suggestions.generated_at ?? new Date().toISOString();
    const expiresAt =
      persisted[0]?.expiresAt?.toISOString() ??
      new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();

    return {
      upload_batch_id: `batch_${Date.now()}`,
      processing_summary: {
        total_processed: dto.contacts.length,
        successfully_matched: suggestions.suggestions.length,
        validation_failures: normalization.invalidIdentifiers.length,
        duplicates_found: duplicateCount,
        type_breakdown: {
          [ContactIdentifierType.PHONE]:
            normalization.typeBreakdown[ContactIdentifierType.PHONE] ?? 0,
          [ContactIdentifierType.EMAIL]:
            normalization.typeBreakdown[ContactIdentifierType.EMAIL] ?? 0,
        },
      },
      suggestions: suggestions.suggestions,
      invalid_identifiers: normalization.invalidIdentifiers,
      pagination: suggestions.pagination,
      processed_at: processedAt,
      retention_info: {
        retention_period_days: retentionDays,
        expires_at: expiresAt,
        can_delete_anytime: true,
      },
      privacy_controls: {
        discovery_enabled: true,
        mutual_discovery_only: false,
        can_opt_out: true,
      },
    };
  }

  private buildEmptySuggestionResponse(): ContactSuggestionResponseDto {
    const now = new Date().toISOString();
    return {
      suggestions: [],
      pagination: {
        page: 1,
        offset: 0,
        limit: 0,
        total: 0,
        total_pages: 1,
        has_next: false,
        has_more: false,
        has_previous: false,
      },
      generated_at: now,
      cache_info: {
        cached: false,
        cache_expires_at: now,
        fresh_data_available_at: now,
      },
      summary_stats: {
        total_mutual: 0,
        total_one_sided: 0,
        avg_confidence: 0,
        newest_match_age_hours: 0,
      },
    };
  }

  private buildDeletionResponse(
    result: DeletionResult,
  ): ContactDeletionResponseDto {
    return {
      deletion_batch_id: `deletion_${Date.now()}`,
      deletion_summary: {
        contacts_deleted: result.contactsDeleted,
        suggestions_cleared: result.suggestionsCleared,
        mutual_discoveries_removed: result.mutualDiscoveriesRemoved,
        completed_at: result.completedAt.toISOString(),
      },
      privacy_settings: {
        discovery_enabled: result.privacySettings.discoveryEnabled,
        discovery_opted_out: result.privacySettings.discoveryOptedOut,
        mutual_discovery_only: result.privacySettings.mutualDiscoveryOnly,
        last_updated: result.privacySettings.lastUpdated.toISOString(),
      },
      removal_info: {
        immediate_removal: true,
        full_purge_within_days: 30,
        audit_retention_days: 2555,
        can_re_enable: !result.privacySettings.discoveryOptedOut,
      },
      compliance_info: {
        gdpr_compliant: true,
        ccpa_compliant: true,
        right_to_be_forgotten: true,
        data_portability_available: false,
      },
    };
  }

  private resolveNumberConfig(key: string, fallback: number): number {
    const value = this.configService.get(key as any) as unknown;

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  private applyAnomalyAssessment(params: {
    assessment: AnomalyAssessment;
    legacyResult: ContactUploadResponseDto;
    correlationId: string;
    summary: UploadSummary;
  }): void {
    const { assessment, legacyResult, correlationId, summary } = params;

    if (!assessment || assessment.signals.length === 0) {
      return;
    }

    legacyResult.security_review = {
      action: assessment.action,
      cooldown_seconds: assessment.cooldownSeconds,
      signals: assessment.signals.map((signal) => ({
        type: signal.type,
        severity: signal.severity,
        message: signal.message,
      })),
    };

    if (assessment.action === "challenge") {
      legacyResult.suggestions = [];
      legacyResult.processing_summary.successfully_matched = 0;
      legacyResult.pagination.total = 0;
      legacyResult.pagination.offset = 0;
      legacyResult.pagination.total_pages = 0;
      legacyResult.pagination.has_next = false;
      legacyResult.pagination.has_more = false;
      legacyResult.pagination.has_previous = false;
      summary.suggestions = null;
      return;
    }

    if (assessment.action === "block") {
      throw new AnomalousContactUploadException(
        assessment.signals.map((signal) => signal.type),
        correlationId,
        assessment.cooldownSeconds,
      );
    }
  }

  private createPrivacyHash(value: string): string {
    return createHash("sha256")
      .update(value ?? "unknown")
      .digest("hex");
  }

  private withContext(context: RequestContext): Record<string, unknown> {
    return {
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      userTier: context.userTier,
      userAgent: context.userAgent,
      ipHash: context.ipAddressHash,
      deviceHash: context.deviceIdHash,
    };
  }
}
