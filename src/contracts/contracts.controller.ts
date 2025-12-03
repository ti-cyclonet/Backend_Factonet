import { Controller, Get, Headers, Logger } from '@nestjs/common';
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
}