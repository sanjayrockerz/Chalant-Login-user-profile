import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  correlationId?: string;
  timestamp: string;
  path: string;
  errorCode?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId = request.correlationId || 'unknown';
    const timestamp = new Date().toISOString();
    const path = request.url;

    let status: number;
    let message: string | string[];
    let error: string;
    let errorCode: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || exception.message;
        error = responseObj.error || exception.name;
        errorCode = this.getErrorCode(status, exception);
      } else {
        message = exceptionResponse as string;
        error = exception.name;
        errorCode = this.getErrorCode(status, exception);
      }
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'InternalServerError';
      errorCode = 'INTERNAL_SERVER_ERROR';
      
      // Log the actual error for debugging
      this.logger.error({
        message: 'Unhandled exception',
        correlationId,
        error: {
          name: exception.name,
          message: exception.message,
          stack: exception.stack,
        },
        timestamp,
        path,
      });
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Unknown error occurred';
      error = 'UnknownError';
      errorCode = 'UNKNOWN_ERROR';
      
      this.logger.error({
        message: 'Unknown exception type',
        correlationId,
        exception: String(exception),
        timestamp,
        path,
      });
    }

    const errorResponse: ErrorResponse = {
      statusCode: status,
      message,
      error,
      correlationId,
      timestamp,
      path,
      errorCode,
    };

    // Log the error response
    this.logger.error({
      message: 'HTTP exception occurred',
      statusCode: errorResponse.statusCode,
      error: errorResponse.error,
      correlationId: errorResponse.correlationId,
      timestamp: errorResponse.timestamp,
      path: errorResponse.path,
      errorCode: errorResponse.errorCode,
      errorMessage: errorResponse.message,
      userAgent: request.get('User-Agent'),
      ip: request.ip,
      method: request.method,
    });

    response.status(status).json(errorResponse);
  }

  private getErrorCode(status: number, exception: HttpException): string {
    // Map common HTTP exceptions to error codes
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'VALIDATION_ERROR';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMIT_EXCEEDED';
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return 'INTERNAL_SERVER_ERROR';
      default:
        return `HTTP_${status}`;
    }
  }
}