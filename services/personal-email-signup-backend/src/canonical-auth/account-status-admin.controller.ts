import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserAccountStatus } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequestWithPrincipal } from "./canonical-auth.types";
import { AuthAdminGuard } from "./auth-admin.guard";
import { CanonicalAuthService } from "./canonical-auth.service";

@Controller("auth/admin/accounts")
@UseGuards(JwtAuthGuard, AuthAdminGuard)
export class AccountStatusAdminController {
  constructor(private readonly auth: CanonicalAuthService) {}

  @Patch(":userId/status")
  @HttpCode(HttpStatus.OK)
  changeStatus(
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Headers("idempotency-key") operationId: string | undefined,
    @Body() body: { status?: unknown },
    @Req() request: RequestWithPrincipal,
  ) {
    if (
      typeof operationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        operationId,
      )
    ) {
      throw new BadRequestException("A UUID v4 Idempotency-Key is required");
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !Object.values(UserAccountStatus).includes(
        body.status as UserAccountStatus,
      )
    ) {
      throw new BadRequestException("A valid account status is required");
    }
    if (!request.user?.subject) {
      throw new BadRequestException(
        "Authenticated administrator identity is missing",
      );
    }

    return this.auth.changeAccountStatus({
      operationId,
      targetId: userId,
      actorId: request.user.subject,
      accountStatus: body.status as UserAccountStatus,
    });
  }
}
