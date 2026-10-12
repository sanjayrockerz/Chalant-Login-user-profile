import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Optional,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequestWithPrincipal } from "../canonical-auth/canonical-auth.types";
import { CanonicalProfileService } from "./canonical-profile.service";
import {
  UpdateCanonicalProfileDto,
  UpdateOnboardingDto,
} from "./canonical-profile.dto";
import { UserService } from "./user.service";
import { MetricsService } from "../metrics/metrics.service";
import { HtmlSanitizerService } from "../security/html-sanitizer.service";
import { Request, Response } from "express";

type LegacyUser = { id?: string; subject?: string };

function getLegacyUser(request: unknown): LegacyUser | undefined {
  if (typeof request !== "object" || request === null) return undefined;
  const candidate = (request as { user?: unknown }).user;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const record = candidate as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    subject: typeof record.subject === "string" ? record.subject : undefined,
  };
}

@Controller("profile")
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class ProfileController {
  constructor(
    private readonly userService: UserService,
    private readonly metricsService: MetricsService,
    private readonly htmlSanitizer: HtmlSanitizerService,
    @Optional() private readonly profiles?: CanonicalProfileService,
  ) {}

  @Get("me")
  getMyProfile(@Req() request: RequestWithPrincipal) {
    return this.profiles.getProfile(this.requireSubject(request));
  }

  @Patch("me")
  @HttpCode(HttpStatus.OK)
  updateMyProfile(
    @Req() request: RequestWithPrincipal,
    @Body() input: UpdateCanonicalProfileDto,
  ) {
    return this.profiles.updateProfile(this.requireSubject(request), input);
  }

  @Get("onboarding")
  getMyOnboarding(@Req() request: RequestWithPrincipal) {
    return this.profiles.getOnboarding(this.requireSubject(request));
  }

  @Patch("onboarding")
  @HttpCode(HttpStatus.OK)
  updateMyOnboarding(
    @Req() request: RequestWithPrincipal,
    @Body() input: UpdateOnboardingDto,
  ) {
    return this.profiles.updateOnboarding(this.requireSubject(request), input);
  }

  @Post("pronouns")
  @HttpCode(HttpStatus.OK)
  updatePronouns(
    @Req() request: RequestWithPrincipal,
    @Body() input: Pick<UpdateCanonicalProfileDto, "pronouns">,
  ) {
    return this.profiles?.updateProfile(this.requireSubject(request), input);
  }

  @Post("image")
  @HttpCode(HttpStatus.OK)
  updateImage(
    @Req() request: RequestWithPrincipal,
    @Body()
    input: Pick<UpdateCanonicalProfileDto, "profileImageUrl"> & {
      profile_image_url?: string;
    },
  ) {
    return this.profiles?.updateProfile(this.requireSubject(request), {
      profileImageUrl: input.profileImageUrl ?? input.profile_image_url,
    });
  }

  async setPronouns(
    request: Request,
    response: Response,
    input: { pronouns?: string },
  ) {
    const user = getLegacyUser(request);
    if (!user) return response.status(401).json({ error: "unauthenticated" });
    const value =
      typeof input.pronouns === "string"
        ? this.htmlSanitizer.sanitizeToText(input.pronouns).slice(0, 64)
        : null;
    if (this.profiles && user.subject) {
      await this.profiles.updateProfile(user.subject, {
        pronouns: value || null,
      });
    } else if (user.id) {
      await this.userService.updateUser(user.id, { pronouns: value || null });
    }
    this.metricsService.incrementPronounsSet();
    return response.json({ ok: true });
  }

  async setImage(
    request: Request,
    response: Response,
    input: { profile_image_url?: string },
  ) {
    const user = getLegacyUser(request);
    if (!user) return response.status(401).json({ error: "unauthenticated" });
    const raw =
      typeof input.profile_image_url === "string"
        ? input.profile_image_url.trim()
        : null;
    let url: string | null = null;
    if (raw) {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return response.status(400).json({ error: "invalid_url" });
      }
      url = raw.slice(0, 2048);
    }
    if (this.profiles && user.subject) {
      await this.profiles.updateProfile(user.subject, { profileImageUrl: url });
    } else if (user.id) {
      await this.userService.updateUser(user.id, { profileImageUrl: url });
    }
    this.metricsService.incrementProfileImageSet();
    return response.json({ ok: true });
  }

  private requireSubject(request: RequestWithPrincipal): string {
    if (!request.user?.subject)
      throw new UnauthorizedException("Canonical principal is missing");
    return request.user.subject;
  }
}
