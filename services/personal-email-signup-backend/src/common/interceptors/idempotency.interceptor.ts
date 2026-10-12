import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { RedisService } from '../../redis/redis.service';
import { IDEMPOTENCY_KEY } from '../decorators/idempotent.decorator';

export interface IdempotencyResult {
  statusCode: number;
  data: any;
  headers?: Record<string, string>;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly redisService: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Only apply idempotency to POST, PUT, and PATCH operations
    if (!['POST', 'PUT', 'PATCH'].includes(request.method)) {
      return next.handle();
    }

    // Check if endpoint has idempotency metadata
    const idempotencyMeta = this.reflector.getAllAndOverride<{ required: boolean }>(
      IDEMPOTENCY_KEY,
      [context.getHandler(), context.getClass()],
    );

    const idempotencyKey = request.headers['idempotency-key'] as string;
    
    // Check if idempotency key is required for this endpoint
    if (idempotencyMeta?.required && !idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required for this endpoint');
    }

    // If no idempotency key provided and not required, skip processing
    if (!idempotencyKey) {
      return next.handle();
    }

    // Validate idempotency key format (UUID or similar)
    if (!this.isValidIdempotencyKey(idempotencyKey)) {
      throw new BadRequestException('Invalid idempotency key format. Must be a valid UUID.');
    }

    const cacheKey = this.buildCacheKey(request, idempotencyKey);
    
    try {
      // Check if this request has been processed before
      const existingResult = await this.getStoredResult(cacheKey);
      
      if (existingResult) {
        // Return stored result
        const { statusCode, data, headers } = existingResult;
        
        if (headers) {
          Object.entries(headers).forEach(([key, value]) => {
            response.setHeader(key, value);
          });
        }
        
        response.status(statusCode);
        return of(data);
      }

      // Process the request
      return next.handle().pipe(
        tap(async (responseData) => {
          // Store the result for future idempotent requests
          const result: IdempotencyResult = {
            statusCode: response.statusCode,
            data: responseData,
            headers: this.extractRelevantHeaders(response),
          };

          await this.storeResult(cacheKey, result);
        }),
      );
    } catch (error) {
      throw new ConflictException('Failed to process idempotency check');
    }
  }

  private isValidIdempotencyKey(key: string): boolean {
    // Validate UUID format or similar strong identifier
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(key) || (key.length >= 16 && key.length <= 255);
  }

  private buildCacheKey(request: Request, idempotencyKey: string): string {
    // Include method, path, and user context in cache key
    const userId = request.user?.userId || 'anonymous';
    const path = request.route?.path || request.path;
    const method = request.method;
    
    return `idempotency:${method}:${path}:${userId}:${idempotencyKey}`;
  }

  private async getStoredResult(cacheKey: string): Promise<IdempotencyResult | null> {
    const stored = await this.redisService.get(cacheKey);
    return stored ? JSON.parse(stored) : null;
  }

  private async storeResult(cacheKey: string, result: IdempotencyResult): Promise<void> {
    // Store result for 24 hours
    const ttl = 24 * 60 * 60; // 24 hours in seconds
    await this.redisService.set(cacheKey, JSON.stringify(result), ttl);
  }

  private extractRelevantHeaders(response: Response): Record<string, string> {
    const relevantHeaders: Record<string, string> = {};
    const headersToStore = ['location', 'x-correlation-id', 'x-request-id'];
    
    headersToStore.forEach(header => {
      const value = response.getHeader(header);
      if (value) {
        relevantHeaders[header] = String(value);
      }
    });
    
    return relevantHeaders;
  }
}