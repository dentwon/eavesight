import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { SolarService } from './solar.service';
import { RentCastService } from './rentcast.service';
import { TracerfyService } from './tracerfy.service';
import { GeocodingService } from './geocoding.service';
import { DataPipelineModule } from '../data-pipeline/data-pipeline.module';

@Module({
  imports: [DataPipelineModule],
  controllers: [PropertiesController],
  providers: [
    PropertiesService,
    SolarService,
    RentCastService,
    TracerfyService,
    GeocodingService,
  ],
  exports: [
    PropertiesService,
    SolarService,
    RentCastService,
    TracerfyService,
    GeocodingService,
  ],
})
export class PropertiesModule {}
