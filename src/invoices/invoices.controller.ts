import { Controller, Get, Post, UseGuards, UseInterceptors, Body, Query, Patch, Param } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActivePeriodInterceptor } from '../common/interceptors/active-period.interceptor';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  findAll() {
    return this.invoicesService.findAll();
  }

  @Get('check-period')
  checkInvoicesInPeriod(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.invoicesService.checkInvoicesInPeriod(startDate, endDate);
  }

  @Post('sweep')
  @UseInterceptors(ActivePeriodInterceptor)
  sweepInvoices() {
    return this.invoicesService.sweepInvoices();
  }

  @Patch(':id/status')
  updateInvoiceStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.invoicesService.updateInvoiceStatus(+id, body.status);
  }
}