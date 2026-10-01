import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportFiltersDto } from './dto/report-filters.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminFactonetGuard } from '../auth/guards/admin-factonet.guard';

// Reportes con datos de todos los clientes: solo el administrador de FactoNet
@Controller('reports')
@UseGuards(JwtAuthGuard, AdminFactonetGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('clients')
  getClientsReport(@Query() filters: ReportFiltersDto) {
    return this.reportsService.getClientsReport(filters);
  }

  @Get('contracts')
  getContractsReport(@Query() filters: ReportFiltersDto) {
    return this.reportsService.getContractsReport(filters);
  }

  @Get('invoices')
  getInvoicesReport(@Query() filters: ReportFiltersDto) {
    return this.reportsService.getInvoicesReport(filters);
  }

  @Get('profits')
  getProfitsReport(@Query() filters: ReportFiltersDto) {
    return this.reportsService.getProfitsReport(filters);
  }

  @Get('taxes')
  getTaxesReport(@Query() filters: ReportFiltersDto) {
    return this.reportsService.getTaxesReport(filters);
  }

  @Get('global-parameters')
  getGlobalParametersReport(@Query() filters: ReportFiltersDto) {
    return this.reportsService.getGlobalParametersReport(filters);
  }

  @Get('management-indicators')
  getManagementIndicators(@Query() filters: ReportFiltersDto) {
    return this.reportsService.getManagementIndicators(filters);
  }
}
