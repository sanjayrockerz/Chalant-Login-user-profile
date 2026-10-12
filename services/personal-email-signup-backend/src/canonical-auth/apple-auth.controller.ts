import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AppleAuthService } from "./apple-auth.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequestWithPrincipal } from "./canonical-auth.types";

@Controller("auth/apple")
export class AppleAuthController {
  constructor(private readonly apple: AppleAuthService) {}

  @Get()
  begin() {
    return this.apple.begin();
  }

  @Post("callback")
  @HttpCode(HttpStatus.OK)
  callback(
    @Body("code") code?: string,
    @Body("state") state?: string,
    @Body("id_token") id_token?: string,
    @Body("user") user?: string,
    @Body("error") error?: string,
  ) {
    return this.apple.callback({ code, state, id_token, user, error });
  }

  @Get("link")
  @UseGuards(JwtAuthGuard)
  link(@Req() request: RequestWithPrincipal) {
    return this.apple.beginLink(request.user.subject, request.sessionId);
  }
}
