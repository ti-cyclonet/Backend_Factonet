import { Controller, Get, Post, Param, Body, Headers, Logger } from '@nestjs/common';
import { ContractsService } from './contracts.service';

@Controller('contracts')
export class ContractsController {
  private readonly logger = new Logger(ContractsController.name);

  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  async findAll(@Headers('authorization') authHeader?: string) {
    this.logger.log('GET /api/contracts - Iniciando consulta de contratos');
    try {
      const result = await this.contractsService.findAll(authHeader);
      this.logger.log(`GET /api/contracts - Éxito: ${result?.length || 0} contratos encontrados`);
      return result;
    } catch (error) {
      this.logger.error(`GET /api/contracts - Error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post(':id/pdf')
  async uploadPDF(
    @Param('id') contractId: string,
    @Body() body: { pdfBuffer: string },
    @Headers('authorization') authHeader?: string
  ) {
    this.logger.log(`POST /api/contracts/${contractId}/pdf - Subiendo PDF`);
    try {
      const pdfBuffer = Buffer.from(body.pdfBuffer, 'base64');
      const pdfUrl = await this.contractsService.uploadContractPDF(contractId, pdfBuffer, authHeader);
      this.logger.log(`POST /api/contracts/${contractId}/pdf - Éxito: PDF subido`);
      return { pdfUrl };
    } catch (error) {
      this.logger.error(`POST /api/contracts/${contractId}/pdf - Error: ${error.message}`, error.stack);
      throw error;
    }
  }
}