import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequestWithPrincipal } from "../canonical-auth/canonical-auth.types";
import { AcceptPolicyDto } from "./canonical-policy.dto";
import { CanonicalPolicyService } from "./canonical-policy.service";

@Controller("profile/policy")
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class CanonicalPolicyController {
  constructor(private readonly policies: CanonicalPolicyService) {}

  @Patch("accept")
  @HttpCode(HttpStatus.OK)
  accept(@Req() request: RequestWithPrincipal, @Body() input: AcceptPolicyDto) {
    if (!request.user?.subject) {
      throw new UnauthorizedException("Canonical principal is missing");
    }
    return this.policies.accept(request.user.subject, input);
  }
}
