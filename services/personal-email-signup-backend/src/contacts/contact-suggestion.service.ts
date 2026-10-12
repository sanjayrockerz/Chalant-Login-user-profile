import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Counter, Histogram, register } from 'prom-client';
import { ConfigService } from '../config/config.service';
import {
  ContactIdentifierType,
  ContactSuggestionDto,
  ContactSuggestionResponseDto,
  MatchType,
  SuggestionQueryDto,
} from './dto/contacts.dto';
import { ContactsRepository, SuggestionRecord } from './contacts.repository';
import { ContactsFeatureFlagService } from './contacts-feature-flags.service';
import { ContactsObservabilityService } from './contacts-observability.service';
import { RankingMetrics, SuggestionRankingService } from './suggestion-ranking.service';
import { MatchCandidate, PrismaTransactionClient, RequestContext } from './contacts.types';

interface GenerateSuggestionsParams {
  userId: string;
  matches: MatchCandidate[];
  context: RequestContext;
  query?: SuggestionQueryDto;
}

interface ListSuggestionsParams {
  userId: string;
  query: SuggestionQueryDto;
  context: RequestContext;
}

interface RankingOverrides {
  weights?: {
    confidenceScore: number;
    mutualMatch: number;
    recencyBoost: number;
    connectionCount: number;
  };
  decayFactors?: {
    recencyHalfLife: number;
    confidenceThreshold: number;
  };
}

type PersistableMatchType = MatchType.MUTUAL | MatchType.ONE_SIDED;

interface RankedCandidate {
  candidateKey: string;
  suggestedUserId: string;
  matchType: PersistableMatchType;
  matchStrength: number;
  matchSource: ContactIdentifierType;
  discoveredAt: Date;
  displayName?: string;
  profileImageUrl?: string | null;
  mutualConnections?: number;
  isActive?: boolean;
  isActionable: boolean;
  tieBreaker: number;
}

const suggestionsGeneratedCounter: Counter<'match_type' | 'tenant_id'> = (() => {
  const existing = register.getSingleMetric('contacts_suggestions_generated_total');
  if (existing) {
    return existing as Counter<'match_type' | 'tenant_id'>;
  }

  return new Counter<'match_type' | 'tenant_id'>({
    name: 'contacts_suggestions_generated_total',
    help: 'Total number of suggestions generated during contact uploads',
    labelNames: ['match_type', 'tenant_id'],
    registers: [register],
  });
})();

const suggestionGenerationDuration: Histogram<'tenant_id'> = (() => {
  const existing = register.getSingleMetric('contacts_suggestion_generation_duration_seconds');
  if (existing) {
    return existing as Histogram<'tenant_id'>;
  }

  return new Histogram<'tenant_id'>({
    name: 'contacts_suggestion_generation_duration_seconds',
    help: 'Latency histogram for contact suggestion generation',
    labelNames: ['tenant_id'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register],
  });
})();

@Injectable()
export class ContactSuggestionService {
  private readonly logger = new Logger(ContactSuggestionService.name);

  constructor(
    private readonly repository: ContactsRepository,
    private readonly rankingService: SuggestionRankingService,
    private readonly featureFlags: ContactsFeatureFlagService,
    private readonly observability: ContactsObservabilityService,
    private readonly configService: ConfigService,
  ) {}

  async generateSuggestions(
    tx: PrismaTransactionClient,
    { userId, matches, context, query }: GenerateSuggestionsParams,
  ): Promise<ContactSuggestionResponseDto> {
    const tenantId = context.tenantId ?? 'unknown';
    const start = process.hrtime.bigint();
    const defaults = this.ensureQueryDefaults(query);
    const storeLimit = this.resolveNumberConfig('CONTACT_SUGGESTION_STORE_LIMIT', 100);
    const responseLimit = defaults.limit;
    const now = new Date();

    if (matches.length === 0) {
      const empty = this.buildSuggestionResponse([], defaults, now, 0);
      this.recordGenerationMetrics(start, context, userId, {
        generated: [],
        returned: [],
        totalAvailable: 0,
        mutualCount: 0,
        oneSidedCount: 0,
      });
      return empty;
    }

    const deduped = new Map<string, RankedCandidate>();
    for (const match of matches) {
      if (!match.isActionable) {
        continue;
      }

      const suggestedUserId = this.coerceUserId(match.candidateUserId);
      if (suggestedUserId === null) {
        this.logger.warn('Skipping match with invalid user id', {
          correlationId: context.correlationId,
          tenantId,
          rawCandidateId: match.candidateUserId,
        });
        continue;
      }
      const matchType = match.matchType === MatchType.MUTUAL ? MatchType.MUTUAL : MatchType.ONE_SIDED;
      const matchStrength = matchType === MatchType.MUTUAL ? 1.0 : 0.7;
      const discoveredAt = match.discoveredAt instanceof Date ? match.discoveredAt : new Date(match.discoveredAt);
      const existing = deduped.get(suggestedUserId);

      if (!existing || matchStrength > existing.matchStrength || discoveredAt > existing.discoveredAt) {
        deduped.set(suggestedUserId, {
          candidateKey: match.candidateUserId,
          suggestedUserId,
          matchType: matchType as PersistableMatchType,
          matchStrength,
          matchSource: match.matchSource,
          discoveredAt,
          displayName: match.displayName,
          profileImageUrl: (match as unknown as { profileImageUrl?: string | null }).profileImageUrl ?? null,
          mutualConnections: match.mutualConnections,
          isActive: match.isActive,
          isActionable: match.isActionable,
          tieBreaker: Math.random(),
        });
      }
    }

    let candidates = Array.from(deduped.values());
    if (candidates.length === 0) {
      const empty = this.buildSuggestionResponse([], defaults, now, 0);
      this.recordGenerationMetrics(start, context, userId, {
        generated: [],
        returned: [],
        totalAvailable: 0,
        mutualCount: 0,
        oneSidedCount: 0,
      });
      return empty;
    }

    const existingConnections = await this.repository.fetchExistingConnections(
      tx,
      userId,
      candidates.map((candidate) => candidate.suggestedUserId),
    );

  candidates = candidates.filter((candidate) => !existingConnections.has(candidate.suggestedUserId));

    candidates.sort((a, b) => {
      if (b.matchStrength !== a.matchStrength) {
        return b.matchStrength - a.matchStrength;
      }

      const timeDiff = b.discoveredAt.getTime() - a.discoveredAt.getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return a.tieBreaker - b.tieBreaker;
    });

    const limited = candidates.slice(0, storeLimit);
    if (limited.length === 0) {
      const empty = this.buildSuggestionResponse([], defaults, now, 0);
      this.recordGenerationMetrics(start, context, userId, {
        generated: [],
        returned: [],
        totalAvailable: 0,
        mutualCount: 0,
        oneSidedCount: 0,
      });
      return empty;
    }

    const userSummaries = await this.repository.fetchUserSummaries(
      tx,
      limited.map((candidate) => candidate.suggestedUserId),
    );

    await this.repository.upsertSuggestions(
      tx,
      userId,
      limited.map((candidate) => ({
        suggestedUserId: candidate.suggestedUserId,
        matchType: candidate.matchType,
        matchStrength: candidate.matchStrength,
        createdAt: now,
      })),
    );

    const decorated = limited.map((candidate) =>
      this.toSuggestionDtoFromCandidate(candidate, userSummaries),
    );

    const rankingOverrides = await this.resolveRankingOverrides(userId, context);
    const rankingContext = {
      userId,
      userTier: context.userTier ?? 'free',
      privacySettings: {
        discoveryEnabled: true,
        mutualDiscoveryOnly: false,
        blockedUsers: [] as string[],
        optedOutUsers: [] as string[],
      },
      correlationId: context.correlationId,
      tenantId,
    };

    const { rankedSuggestions, metrics: rankingMetrics } = await this.rankingService.rankSuggestions(
      decorated,
      rankingContext,
      defaults,
      rankingOverrides,
    );

    const responseSuggestions = rankedSuggestions.slice(0, responseLimit);

    const mutualCount = responseSuggestions.filter((item) => item.match_type === MatchType.MUTUAL).length;
    const oneSidedCount = responseSuggestions.length - mutualCount;

    suggestionsGeneratedCounter.labels({ match_type: MatchType.MUTUAL, tenant_id: tenantId }).inc(mutualCount);
    suggestionsGeneratedCounter.labels({ match_type: MatchType.ONE_SIDED, tenant_id: tenantId }).inc(oneSidedCount);

    const response = this.buildSuggestionResponse(
      responseSuggestions,
      defaults,
      now,
      rankingMetrics?.total_candidates ?? decorated.length,
    );

    this.recordGenerationMetrics(start, context, userId, {
      generated: decorated,
      returned: responseSuggestions,
      totalAvailable: rankingMetrics?.total_candidates ?? decorated.length,
      mutualCount,
      oneSidedCount,
      rankingMetrics,
    });

    return response;
  }

  async listSuggestions(
    tx: PrismaTransactionClient,
    { userId, query, context }: ListSuggestionsParams,
  ): Promise<ContactSuggestionResponseDto> {
    const defaults = this.ensureQueryDefaults(query);
    const since = defaults.since ? new Date(defaults.since) : undefined;
    const sinceFilter = since && !Number.isNaN(since.getTime()) ? since : undefined;

    const { records, total } = await this.repository.fetchSuggestionSummaries(tx, userId, {
      limit: defaults.limit,
      offset: defaults.offset ?? (defaults.page - 1) * defaults.limit,
      matchType: defaults.match_type !== MatchType.ALL ? defaults.match_type : undefined,
      minConfidence: defaults.min_confidence,
      since: sinceFilter,
      excludeAccepted: defaults.active_users_only ?? false,
    });

    const suggestions = records.map((record) => this.toSuggestionDtoFromRecord(record));
    const generatedAt = new Date();

    this.logger.debug('Fetched stored contact suggestions', {
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      userId,
      retrieved: suggestions.length,
      total,
    });

    return this.buildSuggestionResponse(suggestions, defaults, generatedAt, total);
  }

  async markSuggestionsStale(
    _tx: PrismaTransactionClient,
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    this.logger.debug(`Marked suggestions stale for user=${userId}`, {
      correlationId: context.correlationId,
      tenantId: context.tenantId,
    });
  }

  private ensureQueryDefaults(query?: SuggestionQueryDto): SuggestionQueryDto {
    const limitFromConfig = this.resolveNumberConfig('CONTACT_SUGGESTION_PAGE_LIMIT', 20);
    const limit = query?.limit && query.limit > 0 ? Math.min(query.limit, 50) : limitFromConfig;
    const offsetProvided = typeof query?.offset === 'number' && query.offset >= 0;
    const basePage = query?.page && query.page > 0 ? query.page : 1;
    const offset = offsetProvided ? query!.offset! : (basePage - 1) * limit;
    const page = Math.max(1, Math.floor(offset / Math.max(limit, 1)) + 1);

    return {
      ...query,
      page,
      offset,
      limit,
      match_type: query?.match_type ?? MatchType.ALL,
      min_confidence: query?.min_confidence ?? 0.3,
    };
  }

  private coerceUserId(raw: string | number): string | null {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) {
        return null;
      }
      return String(Math.trunc(raw));
    }

    const cleaned = raw.trim();
    if (cleaned.length === 0) {
      return null;
    }

    return cleaned;
  }

  private toSuggestionDtoFromCandidate(
    candidate: RankedCandidate,
    summaries: Map<string, { displayName: string | null; profileImageUrl: string | null }>,
  ): ContactSuggestionDto {
    const summary = summaries.get(candidate.suggestedUserId);
    const displayName = summary?.displayName ?? candidate.displayName ?? 'Suggested Contact';
    const profileImageUrl = summary?.profileImageUrl ?? candidate.profileImageUrl ?? undefined;

    return {
      user_id: String(candidate.suggestedUserId),
      display_name: displayName,
      profile_picture_url: profileImageUrl ?? undefined,
      match_type: candidate.matchType,
      confidence_score: Number(candidate.matchStrength.toFixed(3)),
      match_source: candidate.matchSource,
      discovered_at: candidate.discoveredAt.toISOString(),
      mutual_connections: candidate.mutualConnections,
      is_active: candidate.isActive ?? undefined,
      is_actionable: candidate.isActionable,
    };
  }

  private recordGenerationMetrics(
    start: bigint,
    context: RequestContext,
    userId: string,
    stats: {
      generated: ContactSuggestionDto[];
      returned: ContactSuggestionDto[];
      totalAvailable: number;
      mutualCount: number;
      oneSidedCount: number;
      rankingMetrics?: RankingMetrics;
    },
  ): void {
    const tenantId = context.tenantId ?? 'unknown';
    const elapsedNs = process.hrtime.bigint() - start;
    const elapsedSeconds = Number(elapsedNs) / 1_000_000_000;
    const requestTimeMs = elapsedSeconds * 1000;

    suggestionGenerationDuration.labels({ tenant_id: tenantId }).observe(elapsedSeconds);

    const rankingMetrics = stats.rankingMetrics;
    const totalCandidates = rankingMetrics?.total_candidates ?? stats.generated.length;
    const finalSuggestionsCount = rankingMetrics?.final_suggestions ?? stats.returned.length;
    const fallbackAvgConfidence =
      stats.returned.length === 0
        ? 0
        : stats.returned.reduce((acc, suggestion) => acc + suggestion.confidence_score, 0) /
          stats.returned.length;
    const avgConfidence = rankingMetrics?.avg_ranking_score ?? fallbackAvgConfidence;
    const avgConfidenceRounded = Number(avgConfidence.toFixed(3));
    const fallbackMutualPercentage =
      stats.returned.length === 0 ? 0 : (stats.mutualCount / stats.returned.length) * 100;
    const mutualPercentage = rankingMetrics?.mutual_percentage ?? fallbackMutualPercentage;
    const observedRequestTimeMs = rankingMetrics?.processing_time_ms ?? requestTimeMs;
    const privacyFiltered = rankingMetrics?.privacy_filtered ?? 0;
    const confidenceFiltered = rankingMetrics?.confidence_filtered ?? 0;
    const tierLimited = rankingMetrics?.tier_limited ?? Math.max(0, totalCandidates - finalSuggestionsCount);

    this.observability.trackSuggestionRequest({
      userId,
      correlationId: context.correlationId,
      tenantId,
      requestTimeMs: observedRequestTimeMs,
      totalCandidates,
      privacyFiltered,
      confidenceFiltered,
      tierLimited,
      finalSuggestions: finalSuggestionsCount,
      avgConfidenceScore: avgConfidenceRounded,
      mutualPercentage,
      diversityScore: 0,
      userTier: context.userTier ?? 'free',
    });

    this.logger.debug('Recorded suggestion generation metrics', {
      correlationId: context.correlationId,
      tenantId,
      userId,
      requestTimeMs: observedRequestTimeMs,
      totalCandidates,
      finalSuggestions: finalSuggestionsCount,
      totalAvailable: stats.totalAvailable,
      mutualCount: stats.mutualCount,
      oneSidedCount: stats.oneSidedCount,
      rankingSummary: rankingMetrics
        ? {
            totalCandidates: rankingMetrics.total_candidates,
            finalSuggestions: rankingMetrics.final_suggestions,
            privacyFiltered: rankingMetrics.privacy_filtered,
            confidenceFiltered: rankingMetrics.confidence_filtered,
            tierLimited: rankingMetrics.tier_limited,
          }
        : undefined,
    });
  }

  private toSuggestionDtoFromRecord(record: SuggestionRecord): ContactSuggestionDto {
    const displayName = record.suggestedUser.displayName ?? 'Suggested Contact';
    const profileImageUrl = record.suggestedUser.profileImageUrl ?? undefined;

    return {
      user_id: record.suggestedUserId,
      display_name: displayName,
      profile_picture_url: profileImageUrl,
      match_type: record.matchType === MatchType.MUTUAL ? MatchType.MUTUAL : MatchType.ONE_SIDED,
      confidence_score: Number(record.matchStrength.toFixed(3)),
      match_source: ContactIdentifierType.PHONE,
      discovered_at: record.createdAt.toISOString(),
      mutual_connections: undefined,
      is_active: undefined,
      is_actionable: !record.stale,
    };
  }

  private buildSuggestionResponse(
    suggestions: ContactSuggestionDto[],
    query: SuggestionQueryDto,
    generatedAt: Date,
    totalAvailable?: number,
  ): ContactSuggestionResponseDto {
    const limit = query.limit ?? this.resolveNumberConfig('CONTACT_SUGGESTION_PAGE_LIMIT', 20);
    const offset = query.offset ?? ((query.page ?? 1) - 1) * limit;
    const total = typeof totalAvailable === 'number' ? totalAvailable : suggestions.length;
    const page = Math.max(1, Math.floor(offset / Math.max(limit, 1)) + 1);

    const pagination = {
      page,
      offset,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / Math.max(limit, 1))),
      has_next: offset + suggestions.length < total,
      has_more: offset + suggestions.length < total,
      has_previous: offset > 0,
    };

    const summary = this.buildSummaryStats(suggestions, generatedAt);

    return {
      suggestions,
      pagination,
      generated_at: generatedAt.toISOString(),
      cache_info: {
        cached: false,
        cache_expires_at: new Date(generatedAt.getTime() + 15 * 60 * 1000).toISOString(),
        fresh_data_available_at: new Date(generatedAt.getTime() + 5 * 60 * 1000).toISOString(),
      },
      summary_stats: summary,
    };
  }

  private buildSummaryStats(
    suggestions: ContactSuggestionDto[],
    generatedAt: Date,
  ): ContactSuggestionResponseDto['summary_stats'] {
    if (suggestions.length === 0) {
      return {
        total_mutual: 0,
        total_one_sided: 0,
        avg_confidence: 0,
        newest_match_age_hours: 0,
      };
    }

    const totalMutual = suggestions.filter((s) => s.match_type === MatchType.MUTUAL).length;
    const totalOneSided = suggestions.filter((s) => s.match_type !== MatchType.MUTUAL).length;
    const avgConfidence =
      suggestions.reduce((acc, suggestion) => acc + suggestion.confidence_score, 0) /
      suggestions.length;

    const mostRecent = suggestions.reduce((latest, current) => {
      const currentDate = new Date(current.discovered_at);
      return currentDate > latest ? currentDate : latest;
    }, new Date(0));

    const newestMatchAgeHours = (generatedAt.getTime() - mostRecent.getTime()) / (1000 * 60 * 60);

    return {
      total_mutual: totalMutual,
      total_one_sided: totalOneSided,
      avg_confidence: Number(avgConfidence.toFixed(2)),
      newest_match_age_hours: Number(newestMatchAgeHours.toFixed(2)),
    };
  }

  private async resolveRankingOverrides(
    userId: string,
    context: RequestContext,
  ): Promise<RankingOverrides> {
    const evaluation = await this.featureFlags.evaluateABTest('ranking_algorithm', {
      userId,
      userTier: context.userTier ?? 'free',
      tenantId: context.tenantId,
      appVersion: '1.0.0',
      correlationId: context.correlationId,
    });

    if (!evaluation.featureEnabled) {
      return {};
    }

    this.observability.trackFeatureFlagEvaluation(
      context.correlationId,
      context.tenantId,
      userId,
      'ranking_algorithm',
      evaluation.variant ?? 'control',
      evaluation.config ?? {},
    );

    const overrides: RankingOverrides = {};
    const weights = evaluation.config?.weights as Record<string, number> | undefined;
    const decay = evaluation.config?.decayFactors as Record<string, number> | undefined;

    if (
      weights &&
      typeof weights.confidenceScore === 'number' &&
      typeof weights.mutualMatch === 'number' &&
      typeof weights.recencyBoost === 'number' &&
      typeof weights.connectionCount === 'number'
    ) {
      overrides.weights = {
        confidenceScore: weights.confidenceScore,
        mutualMatch: weights.mutualMatch,
        recencyBoost: weights.recencyBoost,
        connectionCount: weights.connectionCount,
      };
    }

    if (
      decay &&
      typeof decay.recencyHalfLife === 'number' &&
      typeof decay.confidenceThreshold === 'number'
    ) {
      overrides.decayFactors = {
        recencyHalfLife: decay.recencyHalfLife,
        confidenceThreshold: decay.confidenceThreshold,
      };
    }

    return overrides;
  }

  private resolveNumberConfig(key: string, fallback: number): number {
    const value = this.configService.get(key as any) as unknown;
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }
}
