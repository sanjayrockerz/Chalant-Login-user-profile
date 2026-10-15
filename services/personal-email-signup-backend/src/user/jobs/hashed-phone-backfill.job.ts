import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.module";
import {
  normalizePhoneNumber,
  NormalizationError,
} from "@auth/phone-normalization";
import { hash, verify } from "../../security/phone-hash/phone-hash.util";
import { ConfigService } from "../../config/config.service";

export interface BackfillBatchStats {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  batchSize: number;
}

export interface BackfillRunOptions {
  batchSize?: number;
  dryRun?: boolean;
  throttleMs?: number;
}

@Injectable()
export class HashedPhoneBackfillJob {
  private readonly logger = new Logger(HashedPhoneBackfillJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async runBatch(
    options: BackfillRunOptions = {},
  ): Promise<BackfillBatchStats> {
    if (this.config.get("CONTACT_HASH_MODE") !== "sha256-v1") {
      throw new Error(
        "Legacy phone-hash backfill is disabled outside CONTACT_HASH_MODE=sha256-v1; use the approved secure re-index procedure.",
      );
    }

    const batchSize = options.batchSize ?? 500;
    const dryRun = options.dryRun ?? false;

    const candidates = await this.prisma.user.findMany({
      where: {
        phone: {
          not: null,
        },
        hashedPhone: null,
        NOT: {
          phone: "",
        },
      },
      select: {
        id: true,
        phone: true,
      },
      orderBy: {
        id: "asc",
      },
      take: batchSize,
    });

    const stats: BackfillBatchStats = {
      processed: candidates.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      batchSize,
    };

    if (candidates.length === 0) {
      return stats;
    }

    for (const record of candidates) {
      try {
        const normalized = normalizePhoneNumber(record.phone);
        const digest = hash(normalized.e164);

        if (!verify(normalized.e164, digest)) {
          throw new Error("Hash verification mismatch");
        }

        if (dryRun) {
          stats.skipped += 1;
          this.logger.log(
            `Dry run: would update user ${record.id} with SHA-256 digest.`,
          );
          continue;
        }

        await this.prisma.user.update({
          where: { id: record.id },
          data: {
            hashedPhone: digest,
          },
        });

        stats.updated += 1;
      } catch (error) {
        if (error instanceof NormalizationError) {
          stats.skipped += 1;
          this.logger.warn(
            `Skipping user ${record.id} due to invalid stored phone: ${error.message}`,
          );
          continue;
        }

        stats.errors += 1;
        this.logger.error(
          `Failed to backfill hashed phone for user ${record.id}: ${(error as Error).message}`,
        );
      }
    }

    return stats;
  }

  async runToCompletion(
    options: BackfillRunOptions = {},
  ): Promise<BackfillBatchStats> {
    const aggregate: BackfillBatchStats = {
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      batchSize: options.batchSize ?? 500,
    };

    while (true) {
      const batchStats = await this.runBatch(options);
      aggregate.processed += batchStats.processed;
      aggregate.updated += batchStats.updated;
      aggregate.skipped += batchStats.skipped;
      aggregate.errors += batchStats.errors;

      if (
        batchStats.processed < batchStats.batchSize ||
        (options.dryRun ?? false)
      ) {
        break;
      }

      if (options.throttleMs && options.throttleMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.throttleMs));
      }
    }

    return aggregate;
  }
}
