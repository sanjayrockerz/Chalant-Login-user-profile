import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap, catchError } from "rxjs/operators";
import { Request, Response } from "express";
import { randomUUID } from "crypto";

// Extend Express Request to include user and correlationId
declare module "express" {
  interface Request {
    user?: any;
    correlationId?: string;
  }
}

export interface LoggingContext {
  correlationId: string;
  method: string;
  url: string;
  userAgent?: string;
  ip: string;
  userId?: string;
  timestamp: string;
  requestBody?: any;
  query?: any;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Generate correlation ID
    const correlationId = randomUUID();

    // Add correlation ID to request for downstream use
    request.correlationId = correlationId;
    response.setHeader("X-Correlation-ID", correlationId);

    const loggingContext: LoggingContext = {
      correlationId,
      method: request.method,
      url: request.url,
      userAgent: request.get("User-Agent"),
      ip: request.ip || request.connection.remoteAddress || "unknown",
      userId: request.user?.userId,
      timestamp: new Date().toISOString(),
      requestBody: this.sanitizeBody(request.body),
      query: request.query,
    };

    const startTime = Date.now();

    // Log incoming request
    this.logger.log({
      message: "Incoming request",
      type: "REQUEST",
      ...loggingContext,
    });

    return next.handle().pipe(
      tap((responseData) => {
        const duration = Date.now() - startTime;

        // Log successful response
        this.logger.log({
          message: "Request completed successfully",
          type: "RESPONSE",
          ...loggingContext,
          statusCode: response.statusCode,
          duration,
          responseSize: JSON.stringify(responseData || {}).length,
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;

        // Log error response
        this.logger.error({
          message: "Request failed",
          type: "ERROR",
          ...loggingContext,
          statusCode: error.status || 500,
          duration,
          error: {
            name: error.name,
            message: error.message,
            stack:
              process.env.NODE_ENV !== "production" ? error.stack : undefined,
          },
        });

        // Add correlation ID to error for client tracking
        error.correlationId = correlationId;

        throw error;
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;

    const sanitized = { ...body };
    const sensitiveFields = [
      "password",
      "token",
      "secret",
      "key",
      "authorization",
    ];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = "[REDACTED]";
      }
    }

    return sanitized;
  }
}
