import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { PropertiesModule } from '../properties/properties.module';

@Module({
  imports: [PropertiesModule],
  controllers: [BillingController],
})
export class BillingModule {}
