import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
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
  ],
})
export class AppModule {}
