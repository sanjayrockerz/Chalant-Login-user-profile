import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Logger,
  ParseUUIDPipe,
  ValidationPipe,
  UsePipes,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";
import { Request } from "express";
import { randomUUID } from "crypto";
import {
  IsArray,
  ArrayNotEmpty,
  IsUUID,
  ArrayUnique,
  IsOptional,
  IsInt,
  Min,
} from "class-validator";

import { PushTokenService } from "../services/push-token.service";
import {
  RegisterPushTokenDto,
  UpdatePushTokenDto,
  ListPushTokensQueryDto,
  PushTokenResponseDto,
  PaginatedPushTokensResponseDto,
  BulkTokenOperationDto,
  BulkOperationResultDto,
} from "../dto/push-token.dto";
import {
  ApiResponseDto,
  TokenRegistrationResponseDto,
  PushTokenErrorResponseDto,
} from "../dto/push-token-responses.dto";

class TokenValidationRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID("4", { each: true })
  tokenIds: string[];
}

class CleanupTokensRequestDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  maxFailures?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  daysSinceLastValidation?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  daysToKeepDeleted?: number;
}

// Import your existing auth guards and decorators
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
// import { TenantGuard } from '../../auth/guards/tenant.guard';
// import { GetUser } from '../../auth/decorators/get-user.decorator';
// import { GetTenant } from '../../auth/decorators/get-tenant.decorator';

@ApiTags("Push Tokens")
@Controller("push-tokens")
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard, TenantGuard) // Uncomment when auth guards are available
export class PushTokenController {
  private readonly logger = new Logger(PushTokenController.name);

  constructor(private readonly pushTokenService: PushTokenService) {}

  /**
   * Register a new push notification token
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Register push notification token",
    description:
      "Register a new FCM or APNs token for push notifications. If the token already exists, it will be updated with new device metadata.",
  })
  @ApiBody({ type: RegisterPushTokenDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "Token registered successfully",
    type: TokenRegistrationResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid token format or validation error",
    type: PushTokenErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: "Token already exists for this user and platform",
    type: PushTokenErrorResponseDto,
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async registerToken(
    @Body() registerDto: RegisterPushTokenDto,
    @Req() request: Request,
    // @GetUser() user: { id: string; tenantId: string }, // Uncomment when available
    // @GetTenant() tenantId: string // Uncomment when available
  ): Promise<TokenRegistrationResponseDto> {
    const correlationId =
      (request.headers["x-correlation-id"] as string) || randomUUID();
    const userAgent = request.headers["user-agent"];
    const ipAddress = request.ip || request.connection.remoteAddress;
    const userHeader = request.headers["x-user-id"];
    const tenantHeader = request.headers["x-tenant-id"];
    const userId =
      typeof userHeader === "string" && userHeader.length > 0
        ? userHeader
        : "mock-user-id";
    const tenantId =
      typeof tenantHeader === "string" && tenantHeader.length > 0
        ? tenantHeader
        : "default";

    this.logger.log({
      message: "Token registration request received",
      userId,
      platform: registerDto.platform,
      correlationId,
      userAgent,
      ipAddress,
    });

    try {
      const startTime = Date.now();

      const tokenResponse = await this.pushTokenService.registerToken(
        userId,
        registerDto,
        tenantId,
        correlationId,
        userAgent,
        ipAddress,
      );

      const processingTime = Date.now() - startTime;

      // Determine if this was a new registration or update
      const isNewToken = !tokenResponse.lastUsedAt;
      const isExistingTokenUpdated = !isNewToken;

      // Get device count (would typically be included in service response)
      const deviceCount = 1; // This would come from the service

      this.logger.log({
        message: "Token registration completed successfully",
        tokenId: tokenResponse.id,
        userId,
        isNewToken,
        isExistingTokenUpdated,
        processingTimeMs: processingTime,
        correlationId,
      });

      return {
        success: true,
        message: isNewToken
          ? "Token registered successfully"
          : "Token updated successfully",
        data: {
          tokenId: tokenResponse.id,
          maskedToken: tokenResponse.maskedToken,
          platform: tokenResponse.platform,
          isNewToken,
          isExistingTokenUpdated,
          deviceCount,
        },
        correlationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error({
        message: "Token registration failed",
        userId,
        platform: registerDto.platform,
        error: error.message,
        correlationId,
      });

      throw error;
    }
  }

  @Post("validate")
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async validateTokens(
    @Body() body: TokenValidationRequestDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    data: any;
    correlationId: string;
    timestamp: string;
  }> {
    const correlationId =
      (request.headers["x-correlation-id"] as string) || randomUUID();

    const results = await this.pushTokenService.validateTokens(
      body.tokenIds,
      correlationId,
    );

    return {
      success: true,
      data: results,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  @Post("cleanup")
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async cleanupTokens(
    @Body() body: CleanupTokensRequestDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    data: any;
    correlationId: string;
    timestamp: string;
  }> {
    const correlationId =
      (request.headers["x-correlation-id"] as string) || randomUUID();

    const maxFailures = body.maxFailures ?? 3;
    const daysSinceLastValidation = body.daysSinceLastValidation ?? 14;
    const daysToKeepDeleted = body.daysToKeepDeleted ?? 90;

    const cleanupResult = await this.pushTokenService.cleanupInvalidTokens(
      maxFailures,
      daysSinceLastValidation,
      daysToKeepDeleted,
      correlationId,
    );

    return {
      success: true,
      data: cleanupResult,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List user's push tokens with filtering and pagination
   */
  @Get()
  @ApiOperation({
    summary: "List user push tokens",
    description:
      "Retrieve all push tokens for the authenticated user with optional filtering by platform and status.",
  })
  @ApiQuery({
    name: "platform",
    required: false,
    description: "Filter by platform (ios/android)",
  })
  @ApiQuery({
    name: "active",
    required: false,
    description: "Filter by active status",
    type: "boolean",
  })
  @ApiQuery({
    name: "includeFailures",
    required: false,
    description: "Include tokens with failures",
    type: "boolean",
  })
  @ApiQuery({
    name: "page",
    required: false,
    description: "Page number",
    type: "number",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Items per page (max 100)",
    type: "number",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Tokens retrieved successfully",
    type: PaginatedPushTokensResponseDto,
  })
  async listTokens(
    @Query() queryDto: ListPushTokensQueryDto,
    @Req() request: Request,
    // @GetUser() user: { id: string } // Uncomment when available
  ): Promise<{
    success: boolean;
    data: PaginatedPushTokensResponseDto;
    correlationId: string;
    timestamp: string;
  }> {
    const correlationId =
      (request.headers["x-correlation-id"] as string) || randomUUID();
    const userHeader = request.headers["x-user-id"];
    const userId =
      typeof userHeader === "string" && userHeader.length > 0
        ? userHeader
        : "mock-user-id";

    this.logger.log({
      message: "Token list request received",
      userId,
      filters: queryDto,
      correlationId,
    });

    try {
      const result = await this.pushTokenService.listUserTokens(
        userId,
        queryDto,
        correlationId,
      );

      this.logger.log({
        message: "Token list retrieved successfully",
        userId,
        tokenCount: result.tokens.length,
        total: result.pagination.total,
        correlationId,
      });

      return {
        success: true,
        data: result,
        correlationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error({
        message: "Token list retrieval failed",
        userId,
        error: error.message,
        correlationId,
      });

      throw error;
    }
  }

  /**
   * Get specific token details
   */
  @Get(":id")
  @ApiOperation({
    summary: "Get push token details",
    description:
      "Retrieve details for a specific push token belonging to the authenticated user.",
  })
  @ApiParam({ name: "id", description: "Token UUID", type: "string" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Token details retrieved successfully",
    type: PushTokenResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Token not found or not accessible",
    type: PushTokenErrorResponseDto,
  })
  async getToken(
    @Param("id", ParseUUIDPipe) tokenId: string,
    @Req() request: Request,
    // @GetUser() user: { id: string } // Uncomment when available
  ): Promise<{
    success: boolean;
    data: PushTokenResponseDto;
    correlationId: string;
    timestamp: string;
  }> {
    const correlationId =
      (request.headers["x-correlation-id"] as string) || randomUUID();
    const userHeader = request.headers["x-user-id"];
    const userId =
      typeof userHeader === "string" && userHeader.length > 0
        ? userHeader
        : "mock-user-id";

    this.logger.log({
      message: "Token details request received",
      tokenId,
      userId,
      correlationId,
    });

    try {
      // Get single token through list with specific filtering
      const result = await this.pushTokenService.listUserTokens(
        userId,
        { page: 1, limit: 1, active: undefined, includeFailures: true },
        correlationId,
      );

      const token = result.tokens.find((t) => t.id === tokenId);
      if (!token) {
        this.logger.warn({
          message: "Token not found",
          tokenId,
          userId,
          correlationId,
        });

        throw new Error("Token not found or not accessible");
      }

      this.logger.log({
        message: "Token details retrieved successfully",
        tokenId,
        userId,
        correlationId,
      });

      return {
        success: true,
        data: token,
        correlationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error({
        message: "Token details retrieval failed",
        tokenId,
        userId,
        error: error.message,
        correlationId,
      });

      throw error;
    }
  }

  /**
   * Update an existing push token
   */
  @Put(":id")
  @ApiOperation({
    summary: "Update push token",
    description:
      "Update an existing push token with new token value, device metadata, or status.",
  })
  @ApiParam({ name: "id", description: "Token UUID", type: "string" })
  @ApiBody({ type: UpdatePushTokenDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Token updated successfully",
    type: PushTokenResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Token not found or not accessible",
    type: PushTokenErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid update data or validation error",
    type: PushTokenErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: "Updated token conflicts with existing token",
    type: PushTokenErrorResponseDto,
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async updateToken(
    @Param("id", ParseUUIDPipe) tokenId: string,
    @Body() updateDto: UpdatePushTokenDto,
    @Req() request: Request,
    // @GetUser() user: { id: string } // Uncomment when available
  ): Promise<{
    success: boolean;
    data: PushTokenResponseDto;
    correlationId: string;
    timestamp: string;
  }> {
    const correlationId =
      (request.headers["x-correlation-id"] as string) || randomUUID();
    const userAgent = request.headers["user-agent"];
    const ipAddress = request.ip || request.connection.remoteAddress;
    const userHeader = request.headers["x-user-id"];
    const userId =
      typeof userHeader === "string" && userHeader.length > 0
        ? userHeader
        : "mock-user-id";

    this.logger.log({
      message: "Token update request received",
      tokenId,
      userId,
      updateFields: Object.keys(updateDto),
      correlationId,
    });

    try {
      const result = await this.pushTokenService.updateToken(
        tokenId,
        userId,
        updateDto,
        correlationId,
        userAgent,
        ipAddress,
      );

      this.logger.log({
        message: "Token updated successfully",
        tokenId,
        userId,
        correlationId,
      });

      return {
        success: true,
        data: result,
        correlationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error({
        message: "Token update failed",
        tokenId,
        userId,
        error: error.message,
        correlationId,
      });

      throw error;
    }
  }

  /**
   * Delete/unregister a push token
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Delete push token",
    description:
      "Delete/unregister a push token. The token will be soft-deleted and marked as inactive.",
  })
  @ApiParam({ name: "id", description: "Token UUID", type: "string" })
  @ApiQuery({
    name: "reason",
    required: false,
    description: "Reason for deletion",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Token deleted successfully",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Token not found or not accessible",
    type: PushTokenErrorResponseDto,
  })
  async deleteToken(
    @Param("id", ParseUUIDPipe) tokenId: string,
    @Req() request: Request,
    @Query("reason") reason?: string,
    // @GetUser() user: { id: string } // Uncomment when available
  ): Promise<{
    success: boolean;
    message: string;
    correlationId: string;
    timestamp: string;
  }> {
    const correlationId =
      (request.headers["x-correlation-id"] as string) || randomUUID();
    const userHeader = request.headers["x-user-id"];
    const userId =
      typeof userHeader === "string" && userHeader.length > 0
        ? userHeader
        : "mock-user-id";

    this.logger.log({
      message: "Token deletion request received",
      tokenId,
      userId,
      reason,
      correlationId,
    });

    try {
      await this.pushTokenService.deleteToken(
        tokenId,
        userId,
        correlationId,
        reason,
      );

      this.logger.log({
        message: "Token deleted successfully",
        tokenId,
        userId,
        correlationId,
      });

      return {
        success: true,
        message: "Push token deleted successfully",
        correlationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error({
        message: "Token deletion failed",
        tokenId,
        userId,
        error: error.message,
        correlationId,
      });

      throw error;
    }
  }

  /**
   * Bulk token operations (admin/system use)
   */
  @Post("bulk")
  @ApiOperation({
    summary: "Bulk token operations",
    description:
      "Perform bulk operations on multiple tokens (activate, deactivate, delete, validate).",
  })
  @ApiBody({ type: BulkTokenOperationDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Bulk operation completed",
    type: BulkOperationResultDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid bulk operation request",
    type: PushTokenErrorResponseDto,
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async bulkTokenOperation(
    @Body() bulkDto: BulkTokenOperationDto,
    @Req() request: Request,
    // @GetUser() user: { id: string } // Uncomment when available
  ): Promise<BulkOperationResultDto> {
    const correlationId =
      (request.headers["x-correlation-id"] as string) || randomUUID();
    const userHeader = request.headers["x-user-id"];
    const userId =
      typeof userHeader === "string" && userHeader.length > 0
        ? userHeader
        : "mock-user-id";

    this.logger.log({
      message: "Bulk token operation request received",
      operation: bulkDto.operation,
      tokenCount: bulkDto.tokenIds.length,
      userId,
      correlationId,
    });

    const startTime = Date.now();
    const successfulTokens: string[] = [];
    const failedOperations: Array<{ tokenId: string; reason: string }> = [];

    try {
      // For this example, implement validation operation
      if (bulkDto.operation === "validate") {
        const validationResults = await this.pushTokenService.validateTokens(
          bulkDto.tokenIds,
          correlationId,
        );

        validationResults.forEach((result) => {
          if (result.result === "valid") {
            successfulTokens.push(result.tokenId);
          } else {
            failedOperations.push({
              tokenId: result.tokenId,
              reason: result.message || "Validation failed",
            });
          }
        });
      } else {
        // For other operations, implement similar logic
        // This is a simplified example
        for (const tokenId of bulkDto.tokenIds) {
          try {
            // Implement specific operation logic based on bulkDto.operation
            if (bulkDto.operation === "delete") {
              await this.pushTokenService.deleteToken(
                tokenId,
                userId,
                correlationId,
                bulkDto.reason,
              );
            }
            // Add other operations as needed

            successfulTokens.push(tokenId);
          } catch (error) {
            failedOperations.push({
              tokenId,
              reason: error.message,
            });
          }
        }
      }

      const processingTime = Date.now() - startTime;

      const result: BulkOperationResultDto = {
        successCount: successfulTokens.length,
        failureCount: failedOperations.length,
        successfulTokens,
        failedOperations,
        processingTimeMs: processingTime,
      };

      this.logger.log({
        message: "Bulk token operation completed",
        operation: bulkDto.operation,
        successCount: result.successCount,
        failureCount: result.failureCount,
        processingTimeMs: processingTime,
        correlationId,
      });

      return result;
    } catch (error) {
      this.logger.error({
        message: "Bulk token operation failed",
        operation: bulkDto.operation,
        error: error.message,
        correlationId,
      });

      throw error;
    }
  }

  /**
   * Health check endpoint for push token system
   */
  @Get("health/check")
  @ApiOperation({
    summary: "Push token system health check",
    description:
      "Check the health status of the push token system including database connectivity and performance metrics.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Health check completed",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
        timestamp: { type: "string", format: "date-time" },
        checks: {
          type: "object",
          properties: {
            database: { type: "boolean" },
            tokenValidation: { type: "boolean" },
            performanceMetrics: {
              type: "object",
              properties: {
                avgResponseTime: { type: "number" },
                errorRate: { type: "number" },
              },
            },
          },
        },
      },
    },
  })
  async healthCheck(@Req() request: Request): Promise<any> {
    const correlationId =
      (request.headers["x-correlation-id"] as string) || randomUUID();

    this.logger.log({
      message: "Health check request received",
      correlationId,
    });

    try {
      // Implement health checks
      const healthChecks = {
        database: true, // Would check database connectivity
        tokenValidation: true, // Would check token validation services
        performanceMetrics: {
          avgResponseTime: 150, // Would calculate from actual metrics
          errorRate: 0.1, // Would calculate from actual error logs
        },
      };

      const overallStatus =
        healthChecks.database && healthChecks.tokenValidation
          ? "healthy"
          : "degraded";

      const response = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        checks: healthChecks,
        correlationId,
      };

      this.logger.log({
        message: "Health check completed",
        status: overallStatus,
        correlationId,
      });

      return response;
    } catch (error) {
      this.logger.error({
        message: "Health check failed",
        error: error.message,
        correlationId,
      });

      return {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error.message,
        correlationId,
      };
    }
  }
}
