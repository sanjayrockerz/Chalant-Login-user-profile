import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequestWithPrincipal } from "./canonical-auth.types";
import { GoogleAuthService } from "./google-auth.service";

@Controller("auth/google")
export class GoogleAuthController {
  constructor(private readonly google: GoogleAuthService) {}

  @Get()
  async begin() {
    return this.google.begin();
  }

  @Get("callback")
  callback(@Query("code") code: string, @Query("state") state: string) {
    return this.google.callback(code, state);
  }

  @Get("link")
  @UseGuards(JwtAuthGuard)
  link(@Req() request: RequestWithPrincipal) {
    return this.google.beginLink(request.user.subject, request.sessionId);
  }
}
