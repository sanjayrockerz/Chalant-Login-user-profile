import { Router, Request, Response } from "express";
import { rateLimiter } from "../security/rate-limiting/adaptive-limiter";
import {
  normalizeUsername,
  isValidUsernameForm,
} from "../user/username-normalize";
import { RESERVED_USERNAMES } from "../user/username-utils";
import { MetricsService } from "../metrics/metrics.service";
import { emitAudit, buildAuditEvent } from "../events/audit-emitter";
import { ConfigService } from "../config/config.service";
import { UserService } from "../user/user.service";

const router = Router();

// Dependency resolution will be done by instantiating in the module that mounts this router.

export function usernameRouter({
  userService,
  metricsService,
  configService,
}: {
  userService: UserService;
  metricsService?: MetricsService;
  configService: ConfigService;
}) {
  const r = Router();

  // Availability check - rate limited to deter enumeration
  r.get("/available", rateLimiter, async (req: Request, res: Response) => {
    const start = Date.now();
    const q = String(req.query.q || "").trim();
    const normalized = normalizeUsername(q);

    // basic form validation
    if (!isValidUsernameForm(q)) {
      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res.status(400).json({
        error: "invalid_format",
        message: "Username contains invalid characters or length",
      });
      return;
    }

    // denylist enforcement can be staged
    const enforceDenylist = configService.get("REQUIRE_USERNAME_DENYLIST");
    if (enforceDenylist && RESERVED_USERNAMES.has(normalized)) {
      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res
        .status(409)
        .json({ error: "reserved", message: "Username is reserved" });
    }

    // normalization may be staged
    const enforceNormalization = configService.get(
      "REQUIRE_USERNAME_NORMALIZATION",
    );
    const lookupKey = enforceNormalization ? normalized : q;

    const existing = enforceNormalization
      ? await userService.findByNormalizedUsername(lookupKey)
      : await userService.findByUsername(lookupKey);

    if (metricsService)
      metricsService.requestLatencySeconds.observe((Date.now() - start) / 1000);
    res.json({ available: !existing });
  });

  // Set/update username - conservative change window enforced
  r.post("/", rateLimiter, async (req: Request, res: Response) => {
    const start = Date.now();
    const { username } = req.body as { username?: string };
    const tenantId = req.headers["x-tenant-id"] as string | undefined;
    const correlationId = req.headers["x-correlation-id"] as string | undefined;

    if (!username) {
      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res.status(400).json({ error: "missing_username" });
    }

    if (!isValidUsernameForm(username)) {
      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res.status(400).json({ error: "invalid_format" });
    }

    const normalized = normalizeUsername(username);

    const enforceDenylist = configService.get("REQUIRE_USERNAME_DENYLIST");
    if (enforceDenylist && RESERVED_USERNAMES.has(normalized)) {
      if (metricsService) metricsService.usernameConflictsTotal.inc();
      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res
        .status(409)
        .json({ error: "reserved", message: "Username is reserved" });
    }

    // Check uniqueness
    const enforceNormalization = configService.get(
      "REQUIRE_USERNAME_NORMALIZATION",
    );
    const lookupKey = enforceNormalization ? normalized : username;
    const conflict = enforceNormalization
      ? await userService.findByNormalizedUsername(lookupKey)
      : await userService.findByUsername(lookupKey);
    if (conflict) {
      if (metricsService) metricsService.usernameConflictsTotal.inc();
      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res
        .status(409)
        .json({ error: "conflict", message: "Username already taken" });
    }

    // Enforce change window (conservative): only allow username set if user's last username change > window or unset
    const user = (req as any).user; // assume auth middleware sets req.user
    if (!user) {
      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res.status(401).json({ error: "unauthenticated" });
    }

    const windowSeconds = configService.get("USERNAME_CHANGE_WINDOW_SECONDS");
    const lastChange =
      (user.usernameUpdatedAt && new Date(user.usernameUpdatedAt).getTime()) ||
      0;
    if (lastChange && Date.now() - lastChange < windowSeconds * 1000) {
      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res.status(403).json({
        error: "change_window",
        message: "Username change window has not elapsed",
      });
    }

    // Persist: update user with normalized/display username
    try {
      await userService.updateUser(user.id, {
        username,
        normalizedUsername: normalized,
        displayUsername: username,
        usernameUpdatedAt: new Date(),
      } as any);

      // Emit audit event
      try {
        await emitAudit(
          buildAuditEvent(
            {
              user: { userId: user.id },
              headers: {
                "x-correlation-id": correlationId,
                "x-tenant-id": tenantId,
              },
              body: { username },
            } as any,
            "username.set",
            "success",
            { tenant_id: tenantId, correlation_id: correlationId },
          ),
        );
      } catch (e) {
        // log and continue
        console.warn(
          "Failed to emit username.set audit",
          e instanceof Error ? e.message : String(e),
        );
      }

      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res.json({ ok: true });
    } catch (err) {
      if (metricsService) metricsService.usernameConflictsTotal.inc();
      if (metricsService)
        metricsService.requestLatencySeconds.observe(
          (Date.now() - start) / 1000,
        );
      res.status(500).json({ error: "internal_error" });
    }
  });

  return r.use("/username", r);
}

export default usernameRouter;
