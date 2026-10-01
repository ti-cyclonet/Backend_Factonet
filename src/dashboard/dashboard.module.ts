import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [InvoicesModule, ContractsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
