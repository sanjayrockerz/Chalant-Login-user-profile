import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { AccountDeletionService } from "./account-deletion.service";

const RECOVERY_POLL_INTERVAL_MS = 5_000;
const RECOVERY_BATCH_SIZE = 25;

/** Replays durable PREPARING deletion SOC operations after process/request loss. */
@Injectable()
export class AccountDeletionRecoveryWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AccountDeletionRecoveryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get("AUTH_ACCOUNT_DELETION_ENABLED") !== true) return;
    this.timer = setInterval(
      () => void this.recoverOnce(),
      RECOVERY_POLL_INTERVAL_MS,
    );
    this.timer.unref();
    void this.recoverOnce();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async recoverOnce(): Promise<void> {
    if (
      this.running ||
      this.config.get("AUTH_ACCOUNT_DELETION_ENABLED") !== true
    )
      return;
    this.running = true;
    try {
      await this.deletion.recoverPendingDeletions(RECOVERY_BATCH_SIZE);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: "account_deletion.recovery_poll_failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    } finally {
      this.running = false;
    }
  }
}
