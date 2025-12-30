import { Controller, Get } from '@nestjs/common';
import { PeriodsService } from '../periods/periods.service';

@Controller('global-parameters-periods')
export class GlobalParametersPeriodsController {
  constructor(private readonly periodsService: PeriodsService) {}

  @Get('active')
  getActiveGlobalParameters() {
    return this.periodsService.getActiveGlobalParameters();
  }
}