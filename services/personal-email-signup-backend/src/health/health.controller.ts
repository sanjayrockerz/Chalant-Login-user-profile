/**
 * Health Controller Stub
 *
 * REST API endpoints for health monitoring.
 * This stub enables TypeScript compilation and NestJS DI resolution.
 *
 * TODO: Replace with actual health controller implementation
 * - Add detailed health metrics endpoints
 * - Implement liveness and readiness probes
 * - Add health check authentication
 * - Implement health check caching
 *
 * Consumers: Main application router
 * Priority: Medium (health monitoring)
 */

import { Controller, Get, Logger } from "@nestjs/common";
import { HealthService, HealthStatus } from "./health.service";

/**
 * Health monitoring controller
 */
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly healthService: HealthService) {
    this.logger.log("HealthController stub initialized");
  }

  /**
   * Basic health check endpoint
   */
  @Get()
  async health(): Promise<HealthStatus> {
    this.logger.debug("Health check endpoint called");
    return this.healthService.getHealthStatus();
  }

  /**
   * Liveness probe for Kubernetes
   */
  @Get("live")
  async liveness(): Promise<{ status: string }> {
    this.logger.debug("Liveness probe called");

    // TODO: Implement actual liveness checks
    // - Check if application is running
    // - Check critical dependencies

    return { status: "ok" };
  }

  /**
   * Readiness probe for Kubernetes
   */
  @Get("ready")
  async readiness(): Promise<{ status: string }> {
    this.logger.debug("Readiness probe called");

    // TODO: Implement actual readiness checks
    // - Check if application is ready to serve traffic
    // - Check all dependencies are available

    const healthStatus = await this.healthService.getHealthStatus();

    return {
      status: healthStatus.status === "ok" ? "ready" : "not_ready",
    };
  }
}
