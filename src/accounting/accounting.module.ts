import { Body, Controller, Delete, DynamicModule, Get, Module, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminFactonetGuard } from '../auth/guards/admin-factonet.guard';
import { ACCOUNTING_ENTITIES } from './entities';
import { AccountingService, VoucherInput } from './accounting.service';

/** Contabilidad de CycloNet (etapa 1): solo el administrador de FactoNet. */
@Controller('accounting')
@UseGuards(JwtAuthGuard, AdminFactonetGuard)
export class AccountingController {
  constructor(private readonly service: AccountingService) {}

  @Get('status')
  async status() {
    const c = await this.service.company();
    return { enabled: true, company: { name: c.name, nit: c.nit, autoFrom: c.autoFrom, accountMap: c.accountMap } };
  }

  @Get('accounts') accounts() { return this.service.listAccounts(); }
  @Post('accounts') createAccount(@Body() b: any) { return this.service.createAccount(b); }

  @Get('third-parties') thirdParties(@Query('q') q?: string) { return this.service.listThirdParties(q); }
  @Post('third-parties') saveThirdParty(@Body() b: any) { return this.service.saveThirdParty(b); }

  @Get('vouchers') vouchers(@Query() q: any) { return this.service.listVouchers(q); }
  @Get('vouchers/:id') voucher(@Param('id') id: string) { return this.service.getVoucher(id); }
  @Post('vouchers') create(@Body() b: VoucherInput, @Request() req: any) { return this.service.createVoucher(b, req.user?.email || 'admin'); }
  @Put('vouchers/:id') update(@Param('id') id: string, @Body() b: VoucherInput) { return this.service.updateDraft(id, b); }
  @Post('vouchers/:id/post') post(@Param('id') id: string) { return this.service.post(id); }
  @Post('vouchers/:id/reverse') reverse(@Param('id') id: string, @Body() b: { reason: string }, @Request() req: any) { return this.service.reverse(id, b?.reason, req.user?.email || 'admin'); }
  @Delete('vouchers/:id') remove(@Param('id') id: string) { return this.service.deleteDraft(id); }

  @Get('periods') periods() { return this.service.listPeriods(); }
  @Post('periods/:month/close') close(@Param('month') m: string, @Request() req: any) { return this.service.setPeriod(m, 'CERRADO', req.user?.email || 'admin'); }
  @Post('periods/:month/reopen') reopen(@Param('month') m: string, @Request() req: any) { return this.service.setPeriod(m, 'ABIERTO', req.user?.email || 'admin'); }

  @Get('reports/trial-balance') trial(@Query('from') f: string, @Query('to') t: string) { return this.service.trialBalance(f, t); }
  @Get('reports/income-statement') income(@Query('from') f: string, @Query('to') t: string) { return this.service.incomeStatement(f, t); }
  @Get('reports/balance-sheet') balance(@Query('to') t: string) { return this.service.balanceSheet(t); }
  @Get('reports/ledger') ledger(@Query('account') a: string, @Query('from') f: string, @Query('to') t: string) { return this.service.ledger(a, f, t); }

  /** Contabiliza ya las facturas y pagos de CycloNet pendientes (también corre cada 30 min). */
  @Post('sync') sync(@Request() req: any) { return this.service.syncAuthoriza(req.user?.email || 'admin'); }
}

/** Sin base de datos de contabilidad: la app arranca igual y estas rutas lo explican. */
@Controller('accounting')
@UseGuards(JwtAuthGuard, AdminFactonetGuard)
export class AccountingUnavailableController {
  @Get('status')
  status() {
    return { enabled: false, message: 'La contabilidad aún no está configurada en el servidor (base de datos de FactoNet).' };
  }
}

/** ¿Hay base de datos propia de FactoNet configurada? */
export function accountingDbConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.FACTONET_DB_HOST && env.FACTONET_DB_NAME && env.FACTONET_DB_USER);
}

/**
 * Contabilidad con base de datos propia de FactoNet (FACTONET_DB_*). Si no está
 * configurada, solo se monta el controlador que responde "no configurada":
 * el resto de FactoNet sigue funcionando igual.
 */
@Module({})
export class AccountingModule {
  static register(env: NodeJS.ProcessEnv = process.env): DynamicModule {
    if (!accountingDbConfigured(env)) return { module: AccountingModule, controllers: [AccountingUnavailableController] };
    return {
      module: AccountingModule,
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: env.FACTONET_DB_HOST,
          port: Number(env.FACTONET_DB_PORT || 5432),
          database: env.FACTONET_DB_NAME,
          username: env.FACTONET_DB_USER,
          password: env.FACTONET_DB_PASSWORD,
          entities: ACCOUNTING_ENTITIES,
          synchronize: env.FACTONET_DB_SYNC !== 'false',
          ssl: env.FACTONET_DB_SSL === 'false' ? false : { rejectUnauthorized: false },
        }),
        TypeOrmModule.forFeature(ACCOUNTING_ENTITIES),
      ],
      controllers: [AccountingController],
      providers: [AccountingService],
    };
  }
}

