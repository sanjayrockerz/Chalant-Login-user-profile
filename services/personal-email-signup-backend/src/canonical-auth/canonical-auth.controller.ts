import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  Delete,
  Param,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CanonicalAuthService } from "./canonical-auth.service";
import {
  PasswordLoginInput,
  RegisterPasswordInput,
  RequestWithPrincipal,
} from "./canonical-auth.types";

@Controller("auth")
export class CanonicalAuthController {
  constructor(private readonly auth: CanonicalAuthService) {}

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  register(@Body() input: RegisterPasswordInput) {
    return this.auth.register(input);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() input: PasswordLoginInput) {
    return this.auth.login(input);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body("refresh_token") refreshToken: string) {
    return this.auth.refresh(refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body("refresh_token") refreshToken: string): Promise<void> {
    await this.auth.logout(refreshToken);
  }

  @Post("logout-current")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutCurrent(@Req() request: RequestWithPrincipal): Promise<void> {
    await this.auth.revokeSession(request.user.subject, request.sessionId);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Req() request: RequestWithPrincipal) {
    return { user: request.user };
  }

  @Get("security/methods")
  @UseGuards(JwtAuthGuard)
  methods(@Req() request: RequestWithPrincipal) {
    return this.auth.securityMethods(request.user.subject);
  }

  @Delete("security/providers/:provider")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlink(
    @Req() request: RequestWithPrincipal,
    @Param("provider") provider: string,
  ) {
    if (provider !== "GOOGLE" && provider !== "APPLE") {
      throw new BadRequestException("Only Google or Apple can be unlinked");
    }
    await this.auth.requireRecentSession(
      request.user.subject,
      request.sessionId,
    );
    await this.auth.unlinkProvider(request.user.subject, provider);
  }

  @Post("security/password")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPassword(
    @Req() request: RequestWithPrincipal,
    @Body("password") password: string,
  ) {
    await this.auth.requireRecentSession(
      request.user.subject,
      request.sessionId,
    );
    await this.auth.setPasswordForAuthenticatedUser(
      request.user.subject,
      password,
    );
  }

  @Get("sessions")
  @UseGuards(JwtAuthGuard)
  sessions(@Req() request: RequestWithPrincipal) {
    return this.auth.listSessions(request.user.subject);
  }

  @Delete("sessions/:id")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Req() request: RequestWithPrincipal,
    @Param("id") id: string,
  ) {
    await this.auth.revokeSession(request.user.subject, id);
  }

  @Post("sessions/revoke-all")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAll(@Req() request: RequestWithPrincipal) {
    await this.auth.revokeAllSessions(request.user.subject);
  }
}
