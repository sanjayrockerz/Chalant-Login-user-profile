import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
    @Body() body: { status?: unknown },
    @Req() request: RequestWithPrincipal,
  ) {
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
      targetId: userId,
      actorId: request.user.subject,
      accountStatus: body.status as UserAccountStatus,
    });
  }
}
