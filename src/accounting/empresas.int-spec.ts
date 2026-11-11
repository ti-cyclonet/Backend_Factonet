import { Test } from '@nestjs/testing';
import { AccountingModule } from './accounting.module';
import { AccountingService, CompanySetupRequired } from './accounting.service';
import { PlanService } from './plan.service';
import { InboxService } from './inbox/inbox.service';
import { attachedDocumentXml } from './inbox/fixtures';

/**
 * Contabilidad para varias empresas (fase 3) contra un Postgres real (no corre en la suite normal).
 * Uso: ACCOUNTING_TEST_DB=postgres://postgres:test@localhost:55432/factonet_test npx jest src/accounting/empresas.int-spec.ts --testRegex int-spec
 */
const url = process.env.ACCOUNTING_TEST_DB;
const d = url ? describe : describe.skip;

/** Authoriza simulado: tenant-a con plan (2 comprobantes, 1 factura recibida al mes); tenant-b sin plan activo. */
function mockAuthoriza() {
  global.fetch = jest.fn(async (u: any) => {
    const s = String(u);
    if (s.includes('/tenant/tenant-a/limits')) {
      return { ok: true, status: 200, json: async () => ({ packageName: 'FACTONET INICIA', limits: [
        { variableName: 'nComprobantes', maxValue: 2, targetApplication: 'FactoNet', limitType: 'quantity' },
        { variableName: 'nFacturasRecibidas', maxValue: 1, targetApplication: 'FactoNet', limitType: 'quantity' },
      ] }) } as any;
    }
    return { ok: false, status: 404, json: async () => ({}) } as any;
  }) as any;
}

d('Contabilidad de empresas · integración (Postgres)', () => {
  let acc: AccountingService;
  let plans: PlanService;
  let inbox: InboxService;
  let close: () => Promise<void>;
  const realFetch = global.fetch;
  const A = { tenantId: 'tenant-a' };

  beforeAll(async () => {
    const u = new URL(url!);
    const env = { FACTONET_DB_HOST: u.hostname, FACTONET_DB_PORT: u.port, FACTONET_DB_NAME: u.pathname.slice(1), FACTONET_DB_USER: u.username, FACTONET_DB_PASSWORD: u.password, FACTONET_DB_SSL: 'false' };
    Object.assign(process.env, env, { ACCOUNTING_CYCLONET_TENANT_ID: 'tenant-cyclonet', ACCOUNTING_CYCLONET_NIT: '901515884-3', ACCOUNTING_AUTO_SYNC: 'false', INBOX_DOMAIN: 'facturas.cyclonet.com.co' });
    const mod = await Test.createTestingModule({ imports: [AccountingModule.register(env as any)] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    acc = app.get(AccountingService);
    plans = app.get(PlanService);
    inbox = app.get(InboxService);
    const ds = app.get(require('typeorm').DataSource);
    await ds.query('TRUNCATE acc_inbox_documents, acc_supplier_rules, acc_voucher_lines, acc_vouchers, acc_periods, acc_third_parties, acc_accounts, acc_companies CASCADE');
    mockAuthoriza();
    close = () => app.close();
  });
  afterAll(async () => { global.fetch = realFetch; await close?.(); });

  it('la empresa configura sus datos la primera vez: PUC, buzón propio e IVA descontable', async () => {
    await expect(acc.company(A)).rejects.toBeInstanceOf(CompanySetupRequired);
    const c = await acc.setupCompany(A, { name: 'Tienda La Esquina S.A.S.', nit: '900555666-1', ivaResponsable: true });
    expect(c).toEqual(expect.objectContaining({ tenantId: 'tenant-a', inboxAlias: 'tienda-la-esquina', nit: '900555666-1' }));
    expect(acc.accountMapOf(c).ivaCompras).toBe('240810');
    expect((await acc.listAccounts(A)).length).toBeGreaterThan(80);
    await expect(acc.setupCompany(A, { name: 'Otra', nit: '900555666-1' })).rejects.toThrow(/ya está configurada/);
    expect(await inbox.address(A)).toBe('tienda-la-esquina@facturas.cyclonet.com.co');
  });

  it('cada empresa ve solo su contabilidad', async () => {
    const gasto = { type: 'CE' as const, date: '2026-11-10', description: 'Arriendo local', post: true, lines: [{ accountCode: '513595', debit: 500000 }, { accountCode: '111005', credit: 500000 }] };
    await acc.createVoucher(gasto, 'dueno@tienda.co', A);
    expect((await acc.listVouchers({}, A)).map((v) => v.description)).toEqual(['Arriendo local']);
    expect((await acc.listVouchers({})).map((v) => v.description)).not.toContain('Arriendo local');
    expect((await acc.incomeStatement('2026-11-01', '2026-11-30', A)).gastos).toBe(500000);
    expect((await acc.incomeStatement('2026-11-01', '2026-11-30')).gastos).toBe(0);
  });

  it('límites del plan: comprobantes del mes y empresa sin plan activo', async () => {
    const c = await acc.company(A);
    await plans.assertVoucherQuota('tenant-a', c.id); // 1 de 2
    await acc.createVoucher({ type: 'NC', date: '2026-11-11', description: 'Ajuste', post: true, lines: [{ accountCode: '513595', debit: 1000 }, { accountCode: '111005', credit: 1000 }] }, 'x', A);
    await expect(plans.assertVoucherQuota('tenant-a', c.id)).rejects.toThrow(/Llegaste a los 2 comprobantes/);
    await expect(plans.assertActive('tenant-b')).rejects.toThrow(/no está activo/);
  });

  it('el buzón de la empresa recibe sus facturas y avisa cuando supera las del plan', async () => {
    const xml = (n: string) => Buffer.from(attachedDocumentXml({ number: n, cufe: `cufe-${n}`, customerNit: '900555666' }));
    const [a1] = await inbox.ingestFiles([{ name: 'a1.xml', data: xml('T1') }], { source: 'CORREO' }, await acc.company(A));
    expect(a1.status).toBe('PENDIENTE');
    expect(a1.message || '').not.toMatch(/costo adicional/);
    const [a2] = await inbox.ingestFiles([{ name: 'a2.xml', data: xml('T2') }], { source: 'CORREO' }, await acc.company(A));
    expect(a2.message).toMatch(/Superaste las 1 facturas.*\$300/);
    expect((await inbox.list('PENDIENTE', A)).map((x) => x.number).sort()).toEqual(['T1', 'T2']);
    expect((await inbox.list('PENDIENTE')).map((x) => x.number)).not.toContain('T1');
  });
});
