import {
  Controller,
  Post,
  Body,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from "@nestjs/swagger";
import { PoliciesService } from "./policies.service";

// Optional metrics
let promClient: any = null;
let termsAcceptedCounter: any = null;
let invalidTermsCounter: any = null;
let termsLatencyHistogram: any = null;
try {
  promClient = require("prom-client");
  termsAcceptedCounter = new promClient.Counter({
    name: "terms_accepted_total",
    help: "Total number of successful terms accepted",
  });
  invalidTermsCounter = new promClient.Counter({
    name: "invalid_terms_version_total",
    help: "Total invalid policy_version attempts",
  });
  termsLatencyHistogram = new promClient.Histogram({
    name: "terms_accept_latency_seconds",
    help: "Latency histogram for terms acceptance endpoint",
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
  });
} catch (e) {
  promClient = null;
}

// Optional tracer
let tracer: any = null;
try {
  const { trace } = require("@opentelemetry/api");
  tracer = trace.getTracer("personal-email-signup-backend");
} catch (e) {
  tracer = null;
}

// Enforcement flags (same semantics as other service)
const ENFORCE_MODE = (
  process.env.REQUIRE_TERMS_ENFORCE_MODE || "off"
).toLowerCase();
const CANARY_TENANTS = (process.env.REQUIRE_TERMS_CANARY_TENANTS || "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

@ApiTags("policies")
@ApiBearerAuth("JWT-auth")
@Controller("api")
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Post("policies/accept")
  @ApiOperation({ summary: "Record user acceptance of the active policy" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        policy_version: {
          type: "string",
          description: "Policy version identifier the client claims to accept",
        },
      },
      required: ["policy_version"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Acceptance recorded or enforcement skipped",
    schema: { type: "object" },
  })
  @ApiResponse({
    status: 400,
    description: "Invalid policy_version provided",
    schema: { type: "object" },
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - authentication required",
  })
  async accept(
    @Req() req: any,
    @Body("policy_version") policy_version: string,
  ) {
    const user = req.user;
    if (!user || !user.id) throw new UnauthorizedException();

    const start = process.hrtime();
    const span = tracer ? tracer.startSpan("legal.accept") : null;
    const tenantId = user?.tenantId;
    const shouldEnforce =
      ENFORCE_MODE === "global" ||
      (ENFORCE_MODE === "canary" &&
        tenantId &&
        CANARY_TENANTS.includes(String(tenantId)));
    try {
      const result = await this.policiesService.acceptPolicy(
        user.id,
        policy_version,
        "api",
      );
      if (termsAcceptedCounter) termsAcceptedCounter.inc();
      // If enforcement was disabled for this tenant, return an informative payload
      if (!shouldEnforce) {
        return {
          ok: true,
          policy_version: policy_version,
          accepted_at: null,
          enforcement: "skipped",
        };
      }
      if (span) {
        span.setAttribute("tenant_id", user?.tenantId || null);
        span.setAttribute("subject_id", user?.id || null);
        span.setAttribute("terms_version", policy_version);
        span.setAttribute("outcome", "success");
        span.end();
      }

      const duration = process.hrtime(start);
      const seconds = duration[0] + duration[1] / 1e9;
      if (termsLatencyHistogram) termsLatencyHistogram.observe(seconds);

      return result;
    } catch (err) {
      if (err.message === "unknown_policy_version") {
        if (invalidTermsCounter) invalidTermsCounter.inc();
        if (span) {
          span.setAttribute("outcome", "failure");
          span.end();
        }
        // If enforcement is off for this tenant, return success but note enforcement skipped
        if (!shouldEnforce) {
          return {
            ok: true,
            policy_version:
              process.env.ACTIVE_POLICY_VERSION || "v2025-10-07-1",
            accepted_at: null,
            enforcement: "skipped",
          };
        }
        return {
          status: 400,
          code: "unknown_policy_version",
          message: "The policy_version provided is not recognized.",
        };
      }
      if (span) {
        span.setStatus({ code: 2, message: err?.message });
        span.end();
      }
      throw err;
    }
  }
}
