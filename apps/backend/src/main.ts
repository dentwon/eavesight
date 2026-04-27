import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * CORS allowlist. Hosts that should be able to talk to the API directly
 * with credentials. Everything else gets a CORS rejection.
 */
function buildCorsOriginCheck(extraOrigin: string | undefined) {
  const allowed = new Set<string>([
    'https://eavesight.com',
    'https://www.eavesight.com',
    'https://app.eavesight.com',
    'https://api.eavesight.com',
  ]);
  if (extraOrigin) allowed.add(extraOrigin.replace(/\/$/, ''));
  // Local dev — only when NODE_ENV !== 'production'.
  if (process.env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:3000');
    allowed.add('http://localhost:3001');
    allowed.add('http://127.0.0.1:3000');
  }
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    // Same-origin / curl / SSR — no Origin header. Allow.
    if (!origin) return cb(null, true);
    return allowed.has(origin)
      ? cb(null, true)
      : cb(new Error(`CORS: origin ${origin} not allowed`));
  };
}

async function bootstrap() {
  // rawBody: true preserves the unparsed body buffer on req.rawBody — required
  // for Stripe webhook signature verification (StripeService.handleWebhook).
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Trust the proxy in front of us (Cloudflare tunnel + cloudflared on
  // localhost). Without this, req.ip is always 127.0.0.1 and the global
  // ThrottlerGuard treats every request as one IP — a single attacker can
  // exhaust the auth bucket for everyone.
  const expressInstance = app.getHttpAdapter().getInstance();
  if (typeof expressInstance.set === 'function') {
    expressInstance.set('trust proxy', 'loopback');
  }

  // Security headers. Helmet defaults are fine for an API. CSP is owned by
  // the frontend (next.config.js); leave it off here to avoid double-CSP.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(cookieParser());

  app.enableCors({
    origin: buildCorsOriginCheck(process.env.NEXT_PUBLIC_APP_URL),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger — disabled in production unless EXPOSE_SWAGGER=1 is set.
  if (process.env.NODE_ENV !== 'production' || process.env.EXPOSE_SWAGGER === '1') {
    const config = new DocumentBuilder()
      .setTitle('Eavesight API')
      .setDescription('Roofing Intelligence Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 4000;
  await app.listen(port, '127.0.0.1');

  console.log(`Eavesight API listening on http://127.0.0.1:${port}`);
}

bootstrap();
