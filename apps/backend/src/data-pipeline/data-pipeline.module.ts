import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CensusService } from './census.service';
import { FemaService } from './fema.service';
import { PropertyEnrichmentService } from './property-enrichment.service';
import { BuildingFootprintsService } from './building-footprints.service';
import { HuntsvilleParcelService } from './huntsville-parcel.service';
import { HuntsvilleParcelController } from './huntsville-parcel.controller';
import { KcsParcelService } from './kcs-parcel.service';
import { KcsParcelController } from './kcs-parcel.controller';
import { MadisonParcelService } from './madison-parcel.service';
import { MadisonParcelController } from './madison-parcel.controller';

@Module({
  imports: [HttpModule],
  controllers: [HuntsvilleParcelController, KcsParcelController, MadisonParcelController],
  providers: [CensusService, FemaService, PropertyEnrichmentService, BuildingFootprintsService, HuntsvilleParcelService, KcsParcelService, MadisonParcelService],
  exports: [CensusService, FemaService, PropertyEnrichmentService, BuildingFootprintsService, HuntsvilleParcelService, KcsParcelService, MadisonParcelService],
})
export class DataPipelineModule {}
