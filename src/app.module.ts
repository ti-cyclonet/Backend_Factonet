import { Module } from '@nestjs/common';
import { configModule } from './config.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { ContractsModule } from './contracts/contracts.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PagosModule } from './pagos/pagos.module';
import { PeriodsModule } from './periods/periods.module';
import { ReportsModule } from './reports/reports.module';
import { AccountingModule } from './accounting/accounting.module';

@Module({
  imports: [
    configModule,
    AuthModule,
    CommonModule,
    ContractsModule,
    DashboardModule,
    InvoicesModule,
    PagosModule,
    PeriodsModule,
    ReportsModule,
    // Contabilidad: con base de datos propia (FACTONET_DB_*); sin ella responde "no configurada"
    AccountingModule.register(),
  ],
})
export class AppModule {}