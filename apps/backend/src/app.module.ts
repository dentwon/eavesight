import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { RolesGuard } from './auth/roles.guard';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PropertiesModule } from './properties/properties.module';
import { StormsModule } from './storms/storms.module';
import { LeadsModule } from './leads/leads.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HealthModule } from './health/health.module';
import { MapModule } from './map/map.module';
import { PrismaModule } from './common/prisma.module';
import { DataPipelineModule } from './data-pipeline/data-pipeline.module';
import { AlertsModule } from './alerts/alerts.module';
import { MetrosModule } from './metros/metros.module';
import { BillingModule } from './billing/billing.module';

/**
 * Custom throttle tracker. Behind Cloudflare tunnel + cloudflared, the
 * cloudflared connector talks to us over loopback. Trust the
 * `cf-connecting-ip` (CF's authoritative header) ONLY when the immediate
 * peer is loopback — otherwise an attacker who can reach :4000 directly
 * on the LAN can spoof any IP via the header to evade their rate-limit
 * bucket OR DoS another user's bucket.
 */
function isLoopbackPeer(req: any): boolean {
  const remote = req?.socket?.remoteAddress || req?.connection?.remoteAddress;
  if (!remote) return false;
  return (
    remote === '127.0.0.1' ||
    remote === '::1' ||
    remote === '::ffff:127.0.0.1' ||
    remote.startsWith('127.')
  );
}

function clientIpFromRequest(req: any): string {
  if (isLoopbackPeer(req)) {
    const cf = req?.headers?.['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf;
    const xff = req?.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  }
  return req?.ip || req?.socket?.remoteAddress || 'unknown';
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60_000, limit: 60 },
        { name: 'auth', ttl: 60_000, limit: 10 },
        { name: 'expensive', ttl: 60_000, limit: 5 },
      ],
      getTracker: (req: any) => clientIpFromRequest(req),
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    PropertiesModule,
    StormsModule,
    LeadsModule,
    AnalyticsModule,
    HealthModule,
    MapModule,
    DataPipelineModule,
    AlertsModule,
    MetrosModule,
    BillingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // RolesGuard is opt-in — it only runs when @Roles or @OrgRoles is set
    // on the handler/controller. Registering globally lets every controller
    // use the decorators without re-listing the guard in @UseGuards.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
