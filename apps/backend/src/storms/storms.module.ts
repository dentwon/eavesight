import { Module } from '@nestjs/common';
import { StormsController } from './storms.controller';
import { StormsService } from './storms.service';

@Module({
  controllers: [StormsController],
  providers: [StormsService],
  exports: [StormsService],
})
export class StormsModule {}
