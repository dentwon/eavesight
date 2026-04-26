import { Module } from '@nestjs/common';
import { MetrosController } from './metros.controller';
import { MetrosService } from './metros.service';
import { PrismaModule } from '../common/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MetrosController],
  providers: [MetrosService],
  exports: [MetrosService],
})
export class MetrosModule {}
