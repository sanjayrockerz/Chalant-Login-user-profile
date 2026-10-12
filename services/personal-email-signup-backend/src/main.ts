import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

function parseDirectives(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService);

  const httpAdapter = app.getHttpAdapter();
  if (typeof (httpAdapter as any).getInstance === 'function') {
    const server = (httpAdapter as any).getInstance();
    if (server?.set) {
      server.set('trust proxy', 1);
    }
  }

  const corsOrigin = config.get('CORS_ORIGIN');
  const allowedOrigins = corsOrigin === '*'
    ? true
    : corsOrigin.split(',').map((origin) => origin.trim()).filter((origin) => origin.length > 0);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: parseDirectives(config.get('CSP_DEFAULT_SRC')),
          scriptSrc: parseDirectives(config.get('CSP_SCRIPT_SRC')),
          styleSrc: parseDirectives(config.get('CSP_STYLE_SRC')),
          imgSrc: parseDirectives(config.get('CSP_IMG_SRC')),
          connectSrc: parseDirectives(config.get('CSP_CONNECT_SRC')),
          fontSrc: parseDirectives(config.get('CSP_FONT_SRC')),
          frameAncestors: parseDirectives(config.get('CSP_FRAME_ANCESTORS')),
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(cookieParser(config.get('COOKIE_SECRET')));

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-Id',
      'X-Device-Id',
      'X-Tenant-Id',
    ],
    exposedHeaders: ['Retry-After', 'X-Correlation-Id'],
  });

  const port = config.get('PORT');
  await app.listen(port);
  logger.log(`Application listening on port ${port}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to bootstrap Nest application', error as Error);
  process.exit(1);
});
