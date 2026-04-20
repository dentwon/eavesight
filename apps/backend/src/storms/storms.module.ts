import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StormsController } from './storms.controller';
import { StormsService } from './storms.service';
import { NoaaService } from './noaa.service';
import { StormsProcessor } from './storms.processor';
import { SpcService } from './spc.service';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [HttpModule, AlertsModule],
  controllers: [StormsController],
  providers: [StormsService, NoaaService, StormsProcessor, SpcService],
  exports: [StormsService],
})
export class StormsModule {}
