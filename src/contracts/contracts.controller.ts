import { Controller, Get, Headers } from '@nestjs/common';
import { ContractsService } from './contracts.service';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  async findAll(@Headers('authorization') authHeader?: string) {
    return await this.contractsService.findAll(authHeader);
  }
}