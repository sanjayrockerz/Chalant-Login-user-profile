import { ApiProperty } from "@nestjs/swagger";

export class HealthResponseDto {
  @ApiProperty({
    description: "Overall service status",
    example: "ok",
    enum: ["ok", "error"],
    type: "string",
  })
  status: "ok" | "error";

  @ApiProperty({
    description: "Additional service information",
    type: "object",
    properties: {
      uptime: { type: "number", example: 12345.67 },
      timestamp: {
        type: "string",
        format: "date-time",
        example: "2024-01-15T10:30:00.000Z",
      },
      version: { type: "string", example: "1.0.0" },
    },
    additionalProperties: true,
  })
  info?: Record<string, any>;

  @ApiProperty({
    description: "Error details if status is error",
    type: "object",
    properties: {
      database: { type: "object", additionalProperties: true },
      redis: { type: "object", additionalProperties: true },
      memory: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  })
  error?: Record<string, any>;

  @ApiProperty({
    description: "Detailed health check results",
    type: "object",
    properties: {
      database: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["up", "down"] },
          response_time: { type: "number" },
        },
        additionalProperties: false,
      },
      redis: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["up", "down"] },
          response_time: { type: "number" },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: true,
  })
  details?: Record<string, any>;
}

export class ReadinessResponseDto {
  @ApiProperty({
    description: "Service readiness status",
    example: "ok",
    enum: ["ok", "shutting_down"],
    type: "string",
  })
  status: "ok" | "shutting_down";

  @ApiProperty({
    description: "Readiness check details",
    type: "object",
    properties: {
      database: { type: "string", enum: ["up", "down"] },
      dependencies: { type: "string", enum: ["ready", "not_ready"] },
    },
    additionalProperties: false,
  })
  checks: {
    database: "up" | "down";
    dependencies: "ready" | "not_ready";
  };
}
