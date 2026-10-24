import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { RequestWithPrincipal } from "./canonical-auth.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const subject = request.user?.subject;
    const configured = this.config.get("AUTH_ADMIN_USER_IDS");
    if (typeof configured !== "string" || configured.trim() === "") {
      throw new ForbiddenException("No Auth administrators are configured");
    }

    const entries = configured.split(",").map((value) => value.trim());
    if (entries.some((value) => !UUID_PATTERN.test(value))) {
      throw new ForbiddenException(
        "Auth administrator configuration is invalid",
      );
    }
    if (
      !subject ||
      !entries.some((value) => value.toLowerCase() === subject.toLowerCase())
    ) {
      throw new ForbiddenException("Auth administrator access is required");
    }
    return true;
  }
}
