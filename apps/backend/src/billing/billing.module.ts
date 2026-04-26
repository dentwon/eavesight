import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';
import { PropertiesModule } from '../properties/properties.module';

@Module({
  imports: [PropertiesModule],
  controllers: [BillingController],
  providers: [StripeService],
  exports: [StripeService],
})
export class BillingModule {}
