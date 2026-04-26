import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    // Default throttle: 60 requests / minute per IP. Stricter limits applied
    // per-route via @Throttle decorators on auth + heavy-write endpoints.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 60 },
      { name: 'auth', ttl: 60_000, limit: 10 },
      { name: 'expensive', ttl: 60_000, limit: 5 },
    ]),
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
  ],
})
export class AppModule {}
