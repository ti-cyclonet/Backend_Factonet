import { Controller, Get, Post, Body, UseGuards, Param, Delete, Patch, Query, Request } from '@nestjs/common';
import { PeriodsService } from './periods.service';
import { CreatePeriodDto } from './dto/create-period.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminFactonetGuard } from '../auth/guards/admin-factonet.guard';

@Controller('periods')
@UseGuards(JwtAuthGuard)
export class PeriodsController {
  constructor(private readonly periodsService: PeriodsService) {}

  @Get('test-connection')
  @UseGuards(AdminFactonetGuard)
  async testConnection() {
    return this.periodsService.testConnection();
  }

  @Post('subperiods')
  @UseGuards(AdminFactonetGuard)
  createSubperiod(@Body() createSubperiodDto: any, @Request() req) {
    return this.periodsService.createSubperiod(createSubperiodDto, req.user?.tenantId ?? null);
  }

  @Post()
  @UseGuards(AdminFactonetGuard)
  create(@Body() createPeriodDto: CreatePeriodDto, @Request() req) {
    return this.periodsService.create(createPeriodDto, req.user?.tenantId ?? null);
  }

  @Get()
  @UseGuards(AdminFactonetGuard)
  findAll() {
    // Los periodos de FactoNet son globales (solo adminFactonet los crea); la
    // tabla de periodos en Authoriza es compartida con otras apps (p. ej.
    // InOut), por eso se filtra por source, no por tenant.
    return this.periodsService.findAll();
  }

  @Get('global-parameters')
  @UseGuards(AdminFactonetGuard)
  getGlobalParameters() {
    return this.periodsService.getGlobalParameters();
  }

  @Get('global-parameters/validate-name')
  @UseGuards(AdminFactonetGuard)
  validateParameterName(@Query('name') name: string) {
    return this.periodsService.validateParameterName(name);
  }

  @Post('global-parameters')
  @UseGuards(AdminFactonetGuard)
  createGlobalParameter(@Body() createParameterDto: any) {
    return this.periodsService.createGlobalParameter(createParameterDto);
  }

  @Post(':id/parameters')
  @UseGuards(AdminFactonetGuard)
  addParametersToPeriod(@Param('id') periodId: string, @Body() body: any) {
    return this.periodsService.addParametersToPeriod(periodId, body.parametros);
  }

  @Get(':id/parameters')
  @UseGuards(AdminFactonetGuard)
  getParametersByPeriod(@Param('id') periodId: string) {
    return this.periodsService.getParametersByPeriod(periodId);
  }

  @Delete(':id')
  @UseGuards(AdminFactonetGuard)
  remove(@Param('id') id: string) {
    return this.periodsService.remove(id);
  }

  @Delete(':id/force')
  @UseGuards(AdminFactonetGuard)
  forceRemove(@Param('id') id: string) {
    return this.periodsService.forceRemove(id);
  }

  @Patch(':id/deactivate')
  @UseGuards(AdminFactonetGuard)
  deactivate(@Param('id') id: string) {
    return this.periodsService.deactivate(id);
  }

  @Patch(':id/activate')
  @UseGuards(AdminFactonetGuard)
  activate(@Param('id') id: string) {
    return this.periodsService.activate(id);
  }

  // Sin AdminFactonetGuard a proposito: ActivePeriodGuard del frontend llama
  // este endpoint para TODOS los roles al entrar a Contratos/Facturas, no
  // solo el administrador. Es global (no depende del tenant de quien
  // pregunta): todos los clientes se rigen por el mismo periodo que
  // configura adminFactonet.
  @Get('active/current')
  getActivePeriod() {
    return this.periodsService.getActivePeriod();
  }

  @Get('validation/check-active')
  @UseGuards(AdminFactonetGuard)
  validateActivePeriod() {
    return this.periodsService.validateActivePeriod();
  }

  @Post('validation/validate-expiry')
  @UseGuards(AdminFactonetGuard)
  validatePeriodExpiry() {
    return this.periodsService.validatePeriodExpiry();
  }
}