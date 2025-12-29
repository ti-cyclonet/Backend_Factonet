import { Module } from '@nestjs/common';
import { PeriodsController } from './periods.controller';
import { PeriodsService } from './periods.service';
import { GlobalParametersPeriodsController } from '../global-parameters-periods/global-parameters-periods.controller';

@Module({
  controllers: [PeriodsController, GlobalParametersPeriodsController],
  providers: [PeriodsService],
})
export class PeriodsModule {}