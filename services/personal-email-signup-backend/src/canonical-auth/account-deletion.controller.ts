import {
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AccountDeletionGuard } from "./account-deletion.guard";
import { CanonicalAuthService } from "./canonical-auth.service";
import { AccountDeletionService } from "./account-deletion.service";
import { RequestWithPrincipal } from "./canonical-auth.types";

@Controller("auth")
export class AccountDeletionController {
  constructor(
    private readonly auth: CanonicalAuthService,
    private readonly deletion: AccountDeletionService,
  ) {}

  @Delete("me")
  @UseGuards(AccountDeletionGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async requestDeletion(
    @Req() request: RequestWithPrincipal,
    @Headers("idempotency-key") operationId?: string,
  ) {
    if (request.deletionRetrySubject) {
      return this.deletion.requestDeletion(
        request.deletionRetrySubject,
        operationId ?? "",
      );
    }
    if (!request.user || !request.sessionId)
      throw new UnauthorizedException("Authentication required");
    await this.auth.requireRecentSession(
      request.user.subject,
      request.sessionId,
    );
    return this.deletion.requestDeletion(
      request.user.subject,
      operationId ?? "",
    );
  }
}
