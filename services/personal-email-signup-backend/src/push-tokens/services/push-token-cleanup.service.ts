/**
 * Push Token Cleanup Service
 * 
 * Automated cleanup of stale push tokens to maintain clean active token lists.
 * Runs daily at 3 AM UTC, processing tokens not validated in 30+ days.
 * 
 * Features:
 * - Batch processing (1000 records per batch) to avoid long transactions
 * - Observability via metrics and structured logging
 * - Safe execution with correlation IDs for tracing
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

interface CleanupResult {
  correlationId: string;
  totalCleaned: number;
  batchCount: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

@Injectable()
export class PushTokenCleanupService {
  private readonly logger = new Logger(PushTokenCleanupService.name);
  private readonly BATCH_SIZE = 1000;
  private readonly STALE_THRESHOLD_DAYS = 30;
  private readonly BATCH_DELAY_MS = 1000; // 1 second between batches

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Scheduled cleanup job - runs daily at 3 AM UTC
   * Cron: 0 3 * * * (minute=0, hour=3, every day)
   */
  @Cron('0 3 * * *', {
    name: 'push-token-cleanup',
    timeZone: 'UTC',
  })
  async scheduledCleanup(): Promise<void> {
    this.logger.log('Starting scheduled push token cleanup job');
    const result = await this.cleanStaleTokens();
    
    if (result.success) {
      this.logger.log(
        `Cleanup job completed successfully: ${result.totalCleaned} tokens cleaned in ${result.batchCount} batches (${result.durationMs}ms)`,
        { correlationId: result.correlationId }
      );
    } else {
      this.logger.error(
        `Cleanup job failed: ${result.error}`,
        undefined,
        { correlationId: result.correlationId }
      );
    }
  }

  /**
   * Execute stale token cleanup with batch processing
   * 
   * @returns CleanupResult with statistics and status
   */
  async cleanStaleTokens(): Promise<CleanupResult> {
    const correlationId = randomUUID();
    const startTime = Date.now();
    let totalCleaned = 0;
    let batchCount = 0;

    try {
      this.logger.log('Cleanup job started', { correlationId });

      // Calculate stale threshold timestamp
      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - this.STALE_THRESHOLD_DAYS);

      let processedInBatch = 0;

      do {
        // Query batch of stale token IDs
        const staleTokens = await this.prisma.pushToken.findMany({
          where: {
            active: true,
            OR: [
              { lastValidatedAt: { lt: staleThreshold } },
              { lastValidatedAt: null },
            ],
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: this.BATCH_SIZE,
        });

        processedInBatch = staleTokens.length;

        if (processedInBatch > 0) {
          // Extract IDs for batch update
          const tokenIds = staleTokens.map(t => t.id);

          // Batch update to mark tokens inactive
          const updateResult = await this.prisma.pushToken.updateMany({
            where: {
              id: { in: tokenIds },
            },
            data: {
              active: false,
              updatedAt: new Date(),
            },
          });

          totalCleaned += updateResult.count;
          batchCount++;

          this.logger.debug(
            `Batch ${batchCount}: Marked ${updateResult.count} tokens inactive`,
            { correlationId, batchCount, processedCount: updateResult.count }
          );

          // Emit metric for monitoring
          this.emitCleanupMetric(updateResult.count);

          // Sleep between batches to avoid DB overload
          if (processedInBatch === this.BATCH_SIZE) {
            await this.sleep(this.BATCH_DELAY_MS);
          }
        }
      } while (processedInBatch === this.BATCH_SIZE);

      const durationMs = Date.now() - startTime;

      this.logger.log(
        `Cleanup completed: ${totalCleaned} stale tokens cleaned in ${batchCount} batches`,
        { correlationId, totalCleaned, batchCount, durationMs }
      );

      // Emit final metrics
      this.emitCleanupDurationMetric(durationMs);
      this.emitActiveTokenCountMetric();

      return {
        correlationId,
        totalCleaned,
        batchCount,
        durationMs,
        success: true,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Cleanup job failed after ${batchCount} batches: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
        { correlationId, totalCleaned, batchCount, durationMs }
      );

      return {
        correlationId,
        totalCleaned,
        batchCount,
        durationMs,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Manual cleanup execution for runbook/debugging
   * Returns preview count before execution
   * 
   * @param dryRun - If true, only count tokens without marking inactive
   * @returns CleanupResult or preview count
   */
  async manualCleanup(dryRun: boolean = false): Promise<CleanupResult | { previewCount: number }> {
    const correlationId = randomUUID();
    const staleThreshold = new Date();
    staleThreshold.setDate(staleThreshold.getDate() - this.STALE_THRESHOLD_DAYS);

    if (dryRun) {
      // Preview mode: count tokens without modifying
      const count = await this.prisma.pushToken.count({
        where: {
          active: true,
          OR: [
            { lastValidatedAt: { lt: staleThreshold } },
            { lastValidatedAt: null },
          ],
        },
      });

      this.logger.log(
        `Dry run: Found ${count} stale tokens to clean`,
        { correlationId, previewCount: count, dryRun: true }
      );

      return { previewCount: count };
    }

    // Execute actual cleanup
    return this.cleanStaleTokens();
  }

  /**
   * Sleep helper for batch processing delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Emit metric for cleaned tokens count
   * Placeholder for actual Prometheus/metrics integration
   */
  private emitCleanupMetric(count: number): void {
    // TODO: Integrate with MetricsService
    // this.metricsService.staleTokensCleanedTotal.inc(count);
    this.logger.debug(`Metric: stale_tokens_cleaned_total += ${count}`);
  }

  /**
   * Emit metric for cleanup job duration
   */
  private emitCleanupDurationMetric(durationMs: number): void {
    // TODO: Integrate with MetricsService
    // this.metricsService.cleanupJobDurationSeconds.observe(durationMs / 1000);
    this.logger.debug(`Metric: cleanup_job_duration_seconds = ${durationMs / 1000}`);
  }

  /**
   * Emit gauge metric for active token counts per platform
   */
  private async emitActiveTokenCountMetric(): Promise<void> {
    try {
      const counts = await this.prisma.pushToken.groupBy({
        by: ['platform'],
        where: { active: true },
        _count: { id: true },
      });

      for (const { platform, _count } of counts) {
        // TODO: Integrate with MetricsService
        // this.metricsService.activeTokensCount.set({ platform }, _count.id);
        this.logger.debug(
          `Metric: active_tokens_count{platform="${platform}"} = ${_count.id}`
        );
      }
    } catch (error) {
      this.logger.warn('Failed to emit active token count metrics', error);
    }
  }
}
