// filepath: src/user/username.service.ts
import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../metrics/metrics.service';
import { UsernameValidationService } from './username-validation.service';

export interface UsernameUpdateResult {
  changed_at: Date;
  next_change_allowed_at?: Date;
}

@Injectable()
export class UsernameService {
  private readonly logger = new Logger(UsernameService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly validationService: UsernameValidationService,
    private readonly metricsService?: MetricsService
  ) {}

  /**
   * Check if a username is available for use
   * Uses case-insensitive comparison via normalizedUsername.
   */
  async isUsernameAvailable(canonical: string, excludeUserId?: string): Promise<boolean> {
    try {
      const whereClause: Prisma.UserWhereInput = {
        normalizedUsername: canonical.toLowerCase(),
      };

      // Exclude current user for username updates
      if (excludeUserId) {
        whereClause.id = { not: excludeUserId };
      }

      const existingUser = await this.prisma.user.findFirst({
        where: whereClause,
        select: { id: true } // Only select id for efficiency
      });

      return !existingUser;
    } catch (error) {
      this.logger.error('Failed to check username availability', {
        error: error.message,
        canonical,
        excludeUserId
      });
      
      // In case of database error, assume not available for safety
      return false;
    }
  }

  /**
   * Get user by ID with username fields
   */
  async getUserById(userId: string): Promise<{
    id: string;
    username: string;
    normalizedUsername?: string | null;
    usernameUpdatedAt?: Date | null;
    usernameChangeCount?: number;
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        normalizedUsername: true,
        usernameUpdatedAt: true
      }
    });

    return user;
  }

  /**
   * Update user's username with proper validation and rate limiting
   */
  async updateUsername(
    userId: string,
    newUsername: string,
    canonical: string,
    correlationId: string
  ): Promise<UsernameUpdateResult> {
    const start = Date.now();

    try {
      // Get current user data
      const currentUser = await this.getUserById(userId);
      
      // Calculate next allowed change time
      const minDaysBetweenChanges = this.configService.get<number>('USERNAME_MIN_DAYS_BETWEEN_CHANGES') || 30;
      const nextChangeAllowedAt = new Date(Date.now() + (minDaysBetweenChanges * 24 * 60 * 60 * 1000));

      // Update username with atomic transaction
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          username: newUsername,
          normalizedUsername: canonical,
          usernameUpdatedAt: new Date(),
          updatedAt: new Date()
        },
        select: {
          id: true,
          username: true,
          normalizedUsername: true,
          usernameUpdatedAt: true
        }
      });

      this.logger.log('Username updated successfully', {
        user_id: userId,
        old_username: this.validationService.sanitizeForLogging(currentUser.username),
        new_username: this.validationService.sanitizeForLogging(newUsername),
        change_count: currentUser.usernameChangeCount || 0,
        correlation_id: correlationId
      });

      // Record metrics
      if (this.metricsService) {
        const duration = Date.now() - start;
        // Assuming these methods exist or will be added to MetricsService
        try {
          this.metricsService.errorsTotal?.inc?.({ type: 'username_update_success' });
        } catch (err) {
          // Metrics failures should not break the main flow
        }
      }

      return {
        changed_at: updatedUser.usernameUpdatedAt!,
        next_change_allowed_at: nextChangeAllowedAt
      };

    } catch (error) {
      this.logger.error('Username update failed', {
        error: error.message,
        user_id: userId,
        new_username: this.validationService.sanitizeForLogging(newUsername),
        correlation_id: correlationId
      });

      // Record error metrics
      if (this.metricsService) {
        try {
          this.metricsService.errorsTotal?.inc?.({ type: 'username_update_error' });
        } catch (err) {
          // Metrics failures should not break the main flow
        }
      }

      // Check if it's a uniqueness constraint violation
      if (error.code === 'P2002' && error.meta?.target?.includes('username')) {
        throw new ConflictException({
          error: 'USERNAME_TAKEN',
          message: 'Username is already taken',
          correlation_id: correlationId
        });
      }

      throw error;
    }
  }

  /**
   * Find user by canonical username (case-insensitive)
   */
  async findByCanonicalUsername(canonical: string): Promise<any> {
    return await this.prisma.user.findFirst({
      where: {
        normalizedUsername: canonical.toLowerCase()
      }
    });
  }

  /**
   * Get username change statistics for monitoring
   */
  async getUsernameChangeStats(): Promise<{
    total_changes_today: number;
    total_changes_this_week: number;
    users_with_recent_changes: number;
  most_changed_usernames: Array<{ user_id: string; change_count: number }>;
  }> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    try {
      const [
        todayChanges,
        weekChanges,
        recentUsers,
        topChangers
      ] = await Promise.all([
        // Changes today
        this.prisma.user.count({
          where: {
            usernameUpdatedAt: {
              gte: todayStart
            }
          }
        }),
        
        // Changes this week
        this.prisma.user.count({
          where: {
            usernameUpdatedAt: {
              gte: weekStart
            }
          }
        }),
        
        // Users with recent changes
        this.prisma.user.count({
          where: {
            usernameUpdatedAt: {
              gte: weekStart
            }
          }
        }),
        
        // Top username changers
        this.prisma.user.findMany({
          where: { usernameUpdatedAt: { not: null } },
          select: {
            id: true,
            usernameUpdatedAt: true
          },
          take: 10
        })
      ]);

      return {
        total_changes_today: todayChanges,
        total_changes_this_week: weekChanges,
        users_with_recent_changes: recentUsers,
        most_changed_usernames: topChangers.map(user => ({
          user_id: user.id,
          change_count: user.usernameUpdatedAt ? 1 : 0
        }))
      };
    } catch (error) {
      this.logger.error('Failed to get username change statistics', error);
      return {
        total_changes_today: 0,
        total_changes_this_week: 0,
        users_with_recent_changes: 0,
        most_changed_usernames: []
      };
    }
  }

  /**
   * Batch update usernames for migration purposes
   * Used during the migration to normalize existing usernames
   */
  async batchUpdateCanonicalUsernames(batchSize: number = 1000): Promise<{
    processed: number;
    updated: number;
    errors: number;
  }> {
    let processed = 0;
    let updated = 0;
    let errors = 0;
    let offset = 0;

    this.logger.log(`Starting batch username canonical update with batch size ${batchSize}`);

    while (true) {
      try {
        // Get batch of users with missing canonical usernames
        const users = await this.prisma.user.findMany({
          where: {
            OR: [
              { normalizedUsername: null },
              { normalizedUsername: '' }
            ]
          },
          select: {
            id: true,
            username: true
          },
          skip: offset,
          take: batchSize
        });

        if (users.length === 0) {
          break; // No more users to process
        }

        // Process each user in the batch
        for (const user of users) {
          try {
            const canonical = this.validationService.normalizeUsername(user.username);
            
            await this.prisma.user.update({
              where: { id: user.id },
              data: { normalizedUsername: canonical }
            });
            
            updated++;
          } catch (error) {
            this.logger.error(`Failed to update canonical username for user ${user.id}`, {
              error: error.message,
              username: user.username
            });
            errors++;
          }
          
          processed++;
        }

        offset += batchSize;
        
        // Log progress
        if (processed % (batchSize * 10) === 0) {
          this.logger.log(`Batch update progress: ${processed} processed, ${updated} updated, ${errors} errors`);
        }

      } catch (error) {
        this.logger.error('Batch update failed', error);
        break;
      }
    }

    this.logger.log(`Batch username canonical update completed: ${processed} processed, ${updated} updated, ${errors} errors`);

    return { processed, updated, errors };
  }
}
