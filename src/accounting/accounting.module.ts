import { Body, Controller, Delete, DynamicModule, ForbiddenException, Get, Module, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ACCOUNTING_ENTITIES, AccCompany } from './entities';
import { AccountingService, Scope, VoucherInput } from './accounting.service';
import { AccountingAccessGuard, assertAdmin, assertCompanyOwner, scopeOf } from './accounting-access';
import { PlanService } from './plan.service';
import { InboxController } from './inbox/inbox.controller';
import { InboxService } from './inbox/inbox.service';
import { InboxMailService } from './inbox/inbox-mail.service';

/**
 * Contabilidad: la de CycloNet (administrador de FactoNet) y la de cada empresa
 * que contrata FactoNet (empresaFactonet, contadorFactonet), según la sesión.
 */
@Controller('accounting')
@UseGuards(JwtAuthGuard, AccountingAccessGuard)
export class AccountingController {
  constructor(private readonly service: AccountingService, private readonly plans: PlanService, private readonly inbox: InboxService) {}

  /** Empresa de la sesión con su plan activo (la de CycloNet no tiene plan). */
  private async scope(req: any): Promise<Scope | undefined> {
    const s = scopeOf(req);
    if (s) await this.plans.assertActive(s.tenantId);
    return s;
  }

  private user(req: any): string {
    return req.user?.email || req.user?.username || 'usuario';
  }

  @Get('status')
  async status(@Request() req: any) {
    const s = scopeOf(req);
    const base = { enabled: true, role: req.user?.rol, isCyclonet: !s };
    if (s) {
      const limits = await this.plans.limits(s.tenantId);
      const plan = { active: limits.active, packageName: limits.packageName, limits: { vouchers: limits.vouchers, received: limits.received }, features: limits.features };
      if (!(await this.service.hasCompany(s))) return { ...base, needsSetup: true, plan };
      const c = await this.service.company(s);
      return { ...base, needsSetup: false, plan: { ...plan, usage: await this.plans.usage(c.id) }, company: this.companyView(c) };
    }
    const c = await this.service.company();
    return { ...base, needsSetup: false, plan: null, company: this.companyView(c) };
  }

  private companyView(c: AccCompany) {
    return {
      name: c.name, nit: c.nit, autoFrom: c.autoFrom, accountMap: c.accountMap,
      ivaResponsable: (c.accountMap?.ivaCompras || 'gasto') !== 'gasto', inboxAddress: this.inbox.addressOf(c),
    };
  }

  /** Primera configuración de la empresa (razón social, NIT, responsable de IVA). */
  @Post('company/setup')
  async setup(@Body() b: { name: string; nit: string; ivaResponsable?: boolean }, @Request() req: any) {
    assertCompanyOwner(req);
    const s = await this.scope(req);
    if (!s) throw new ForbiddenException('La empresa de CycloNet ya está configurada.');
    return this.companyView(await this.service.setupCompany(s, b || ({} as any)));
  }

  @Put('company')
  async updateCompany(@Body() b: { name?: string; nit?: string; ivaResponsable?: boolean }, @Request() req: any) {
    assertCompanyOwner(req);
    return this.companyView(await this.service.updateCompany(await this.scope(req), b || {}));
  }

  @Get('accounts') async accounts(@Request() req: any) { return this.service.listAccounts(await this.scope(req)); }
  @Post('accounts') async createAccount(@Body() b: any, @Request() req: any) { return this.service.createAccount(b, await this.scope(req)); }
  @Get('third-parties') async thirdParties(@Query('q') q: string, @Request() req: any) { return this.service.listThirdParties(q, await this.scope(req)); }
  @Post('third-parties') async saveThirdParty(@Body() b: any, @Request() req: any) { return this.service.saveThirdParty(b, await this.scope(req)); }
  @Get('vouchers') async vouchers(@Query() q: any, @Request() req: any) { return this.service.listVouchers(q, await this.scope(req)); }
  @Get('vouchers/:id') async voucher(@Param('id') id: string, @Request() req: any) { return this.service.getVoucher(id, await this.scope(req)); }

  @Post('vouchers')
  async create(@Body() b: VoucherInput, @Request() req: any) {
    const s = await this.scope(req);
    if (s) await this.plans.assertVoucherQuota(s.tenantId, (await this.service.company(s)).id);
    return this.service.createVoucher(b, this.user(req), s);
  }

  @Put('vouchers/:id') async update(@Param('id') id: string, @Body() b: VoucherInput, @Request() req: any) { return this.service.updateDraft(id, b, await this.scope(req)); }
  @Post('vouchers/:id/post') async post(@Param('id') id: string, @Request() req: any) { return this.service.post(id, await this.scope(req)); }
  @Post('vouchers/:id/reverse') async reverse(@Param('id') id: string, @Body() b: { reason: string }, @Request() req: any) { return this.service.reverse(id, b?.reason, this.user(req), await this.scope(req)); }
  @Delete('vouchers/:id') async remove(@Param('id') id: string, @Request() req: any) { return this.service.deleteDraft(id, await this.scope(req)); }
  @Get('periods') async periods(@Request() req: any) { return this.service.listPeriods(await this.scope(req)); }
  @Post('periods/:month/close') async close(@Param('month') m: string, @Request() req: any) { return this.service.setPeriod(m, 'CERRADO', this.user(req), await this.scope(req)); }
  @Post('periods/:month/reopen') async reopen(@Param('month') m: string, @Request() req: any) { return this.service.setPeriod(m, 'ABIERTO', this.user(req), await this.scope(req)); }
  @Get('reports/trial-balance') async trial(@Query('from') f: string, @Query('to') t: string, @Request() req: any) { return this.service.trialBalance(f, t, await this.scope(req)); }
  @Get('reports/income-statement') async income(@Query('from') f: string, @Query('to') t: string, @Request() req: any) { return this.service.incomeStatement(f, t, await this.scope(req)); }
  @Get('reports/balance-sheet') async balance(@Query('to') t: string, @Request() req: any) { return this.service.balanceSheet(t, await this.scope(req)); }
  @Get('reports/ledger') async ledger(@Query('account') a: string, @Query('from') f: string, @Query('to') t: string, @Request() req: any) { return this.service.ledger(a, f, t, await this.scope(req)); }

  /** Contabiliza ya las facturas y pagos de CycloNet pendientes (también corre cada 30 min). Solo CycloNet. */
  @Post('sync')
  sync(@Request() req: any) {
    assertAdmin(req);
    return this.service.syncAuthoriza(this.user(req));
  }
}

/** Sin base de datos de contabilidad: la app arranca igual y estas rutas lo explican. */
@Controller('accounting')
@UseGuards(JwtAuthGuard, AccountingAccessGuard)
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
      controllers: [InboxController, AccountingController],
      providers: [AccountingService, PlanService, InboxService, InboxMailService],
    };
  }
}

