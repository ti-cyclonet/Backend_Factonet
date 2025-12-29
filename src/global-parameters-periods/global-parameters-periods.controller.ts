import { Controller, Patch, Param, Body } from '@nestjs/common';
import { PeriodsService } from '../periods/periods.service';

@Controller('global-parameters-periods')
export class GlobalParametersPeriodsController {
  constructor(private readonly periodsService: PeriodsService) {}

  @Patch(':id')
  updateParameterStatus(@Param('id') parameterId: string, @Body() body: any) {
    console.log(`[FACTONET] PATCH /global-parameters-periods/${parameterId}`, body);
    if (body.status !== undefined) {
      return this.periodsService.updateParameterStatus(parameterId, body.status);
    } else if (body.value !== undefined) {
      return this.periodsService.updateParameterValue(parameterId, body.value);
    }
    return this.periodsService.updateParameter(parameterId, body);
  }
}