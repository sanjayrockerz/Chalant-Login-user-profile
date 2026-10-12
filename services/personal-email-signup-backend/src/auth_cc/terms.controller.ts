import { 
  Controller, 
  Post, 
  Body, 
  Req, 
  HttpCode, 
  HttpStatus,
  Headers
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { TermsService } from './terms.service';
import { AcceptTermsDto, TermsAcceptanceResponse } from './dto/accept-terms.dto';
import { MetricsService } from '../metrics/metrics.service';

const { trace } = require('@opentelemetry/api');
const tracer = trace.getTracer ? trace.getTracer('personal-email-signup-backend') : null;

@ApiTags('Terms & Privacy')
@Controller('auth/terms')
@ApiBearerAuth()
export class TermsController {
  constructor(
    private readonly termsService: TermsService,
    private readonly metricsService?: MetricsService
  ) {}

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept current terms and privacy policy',
    description: 'Idempotent endpoint to record user acceptance of current active policy version. Authenticated users only.'
  })
  @ApiResponse({
    status: 200,
    description: 'Terms acceptance recorded successfully',
    type: TermsAcceptanceResponse
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid terms version or missing required fields',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'INVALID_TERMS_VERSION' },
        message: { type: 'string', example: 'Invalid terms version. Current active version is v2025-10-08-1' },
        provided_version: { type: 'string', example: 'v2025-10-07-1' },
        required_version: { type: 'string', example: 'v2025-10-08-1' },
        correlation_id: { type: 'string', example: 'req_abc123xyz789' }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication required'
  })
  async acceptTerms(
    @Body() acceptTermsDto: AcceptTermsDto,
    @Req() req: Request & { user?: { id: string, username: string } },
    @Headers('x-correlation-id') correlationId?: string
  ): Promise<TermsAcceptanceResponse> {
    const start = Date.now();
    const span = tracer?.startSpan('terms.accept');
    const finalCorrelationId = correlationId || `terms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Validate user is authenticated
      if (!req.user?.id) {
        throw new Error('Authentication required');
      }

      span?.setAttributes({
        'user.id': req.user.id.toString(),
        'terms.version': acceptTermsDto.terms_version,
        'correlation.id': finalCorrelationId
      });

      // Record terms acceptance
      const result = await this.termsService.acceptTerms(
  req.user.id,
        acceptTermsDto,
        finalCorrelationId
      );

      // Update metrics
      try {
        this.metricsService?.requestDuration.observe(
          { method: 'POST', route: 'auth_terms_accept' },
          Date.now() - start
        );
      } catch (err) {
        // Ignore metrics failures
      }

      span?.setAttributes({
        'terms.accepted': true,
        'terms.accepted_at': result.accepted_at.toISOString()
      });

      return result;

    } catch (error) {
      span?.setAttributes({
        'error': true,
        'error.message': error.message
      });

      // Update error metrics
      try {
        this.metricsService?.errorsTotal.inc({ type: 'terms_acceptance_failed' });
      } catch (err) {
        // Ignore metrics failures
      }

      throw error;
    } finally {
      span?.end();
    }
  }

  @Post('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check user terms acceptance status',
    description: 'Get current terms acceptance status for authenticated user'
  })
  @ApiResponse({
    status: 200,
    description: 'Terms status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        current_version: { type: 'string', example: 'v2025-10-08-1' },
        user_version: { type: 'string', example: 'v2025-10-07-1', nullable: true },
        requires_acceptance: { type: 'boolean', example: true },
        accepted_at: { type: 'string', format: 'date-time', nullable: true }
      }
    }
  })
  async getTermsStatus(
    @Req() req: Request & { user?: { id: string, username: string } },
    @Headers('x-correlation-id') correlationId?: string
  ) {
    const start = Date.now();
    const span = tracer?.startSpan('terms.status');
    const finalCorrelationId = correlationId || `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      if (!req.user?.id) {
        throw new Error('Authentication required');
      }

      span?.setAttributes({
        'user.id': req.user.id.toString(),
        'correlation.id': finalCorrelationId
      });

      const status = await this.termsService.validateUserTermsStatus(req.user.id);

      // Update metrics
      try {
        this.metricsService?.requestDuration.observe(
          { method: 'POST', route: 'auth_terms_status' },
          Date.now() - start
        );
      } catch (err) {
        // Ignore metrics failures
      }

      return {
        current_version: status.currentVersion,
        user_version: status.userVersion,
        requires_acceptance: status.requiresAcceptance,
        correlation_id: finalCorrelationId
      };

    } catch (error) {
      span?.setAttributes({
        'error': true,
        'error.message': error.message
      });

      throw error;
    } finally {
      span?.end();
    }
  }
}