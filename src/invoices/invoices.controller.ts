import { Controller, Get, Post, UseGuards, UseInterceptors, Body, Query, Patch, Param, Request, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InvoicesService } from './invoices.service';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminFactonetGuard } from '../auth/guards/admin-factonet.guard';
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
  @UseGuards(AdminFactonetGuard)
getProfitReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('contractId') contractId?: string
  ) {
    return this.invoicesService.getProfitReport(startDate, endDate, contractId);
  }

  @Get('check-period')
  @UseGuards(AdminFactonetGuard)
checkInvoicesInPeriod(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.invoicesService.checkInvoicesInPeriod(startDate, endDate);
  }

  @Post('sweep')
  @UseGuards(AdminFactonetGuard)
@UseInterceptors(ActivePeriodInterceptor)
  sweepInvoices() {
    return this.invoicesService.sweepInvoices();
  }

  @Post(':id/register-payment')
  @UseInterceptors(FileInterceptor('voucher'))
  async registerPayment(
    @Request() req,
    @Param('id') id: string,
    @Body() body: RegisterPaymentDto,
    @UploadedFile() file?: Express.Multer.File
  ) {
    await this.invoicesService.assertInvoiceAccess(+id, req.user?.tenantId, req.user?.rol);
    return this.invoicesService.registerPayment(+id, body.paymentDate, Number(body.paidAmount), file);
  }

  @Get(':id/voucher')
  async getPaymentVoucher(@Request() req, @Param('id') id: string) {
    await this.invoicesService.assertInvoiceAccess(+id, req.user?.tenantId, req.user?.rol);
    return this.invoicesService.getPaymentVoucher(+id);
  }

  @Post(':id/confirm-payment')
  @UseGuards(AdminFactonetGuard)
confirmPayment(@Param('id') id: string) {
    return this.invoicesService.confirmPayment(+id);
  }

  @Post(':id/reject-payment')
  @UseGuards(AdminFactonetGuard)
rejectPayment(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.invoicesService.rejectPayment(+id, body.reason);
  }

  @Patch(':id/status')
  @UseGuards(AdminFactonetGuard)
updateInvoiceStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.invoicesService.updateInvoiceStatus(+id, body.status);
  }
}