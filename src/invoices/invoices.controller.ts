import { Controller, Get, Post, UseGuards, UseInterceptors, Body, Query, Patch, Param, Request, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActivePeriodInterceptor } from '../common/interceptors/active-period.interceptor';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  findAll(@Request() req) {
    const tenantId = req.user?.tenantId;
    const rol = req.user?.rol;
    return this.invoicesService.findAll(tenantId, rol);
  }

  @Get('profit-report')
  getProfitReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('contractId') contractId?: string
  ) {
    return this.invoicesService.getProfitReport(startDate, endDate, contractId);
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

  @Post(':id/register-payment')
  @UseInterceptors(FileInterceptor('voucher'))
  registerPayment(
    @Param('id') id: string,
    @Body() body: { paymentDate: string; paidAmount: string },
    @UploadedFile() file?: Express.Multer.File
  ) {
    const paidAmount = parseFloat(body.paidAmount);
    return this.invoicesService.registerPayment(+id, body.paymentDate, paidAmount, file);
  }

  @Get(':id/voucher')
  getPaymentVoucher(@Param('id') id: string) {
    return this.invoicesService.getPaymentVoucher(+id);
  }

  @Post(':id/confirm-payment')
  confirmPayment(@Param('id') id: string) {
    return this.invoicesService.confirmPayment(+id);
  }

  @Post(':id/reject-payment')
  rejectPayment(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.invoicesService.rejectPayment(+id, body.reason);
  }

  @Patch(':id/status')
  updateInvoiceStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.invoicesService.updateInvoiceStatus(+id, body.status);
  }
}