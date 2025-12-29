import { Controller, Get, Post, Body, UseGuards, Param } from '@nestjs/common';
import { PeriodsService } from './periods.service';
import { CreatePeriodDto } from './dto/create-period.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('periods')
export class PeriodsController {
  constructor(private readonly periodsService: PeriodsService) {}

  @Post()
  create(@Body() createPeriodDto: CreatePeriodDto) {
    return this.periodsService.create(createPeriodDto);
  }

  @Get()
  findAll() {
    return this.periodsService.findAll();
  }

  @Get('global-parameters')
  getGlobalParameters() {
    return this.periodsService.getGlobalParameters();
  }

  @Post(':id/parameters')
  addParametersToPeriod(@Param('id') periodId: string, @Body() body: any) {
    return this.periodsService.addParametersToPeriod(periodId, body.parametros);
  }

  @Get(':id/parameters')
  getParametersByPeriod(@Param('id') periodId: string) {
    return this.periodsService.getParametersByPeriod(periodId);
  }
}