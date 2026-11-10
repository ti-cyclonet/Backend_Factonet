import { Test } from '@nestjs/testing';
import { AccountingModule } from './accounting.module';
import { AccountingService } from './accounting.service';

/**
 * Prueba de integración contra un Postgres real (no corre en la suite normal).
 * Uso: ACCOUNTING_TEST_DB=postgres://postgres:test@localhost:55432/factonet_test npx jest src/accounting/accounting.int-spec.ts --testRegex int-spec
 */
const url = process.env.ACCOUNTING_TEST_DB;
const d = url ? describe : describe.skip;

d('Contabilidad · integración (Postgres)', () => {
  let service: AccountingService;
  let close: () => Promise<void>;
  const realFetch = global.fetch;

  beforeAll(async () => {
    const u = new URL(url!);
    const env = {
      FACTONET_DB_HOST: u.hostname, FACTONET_DB_PORT: u.port, FACTONET_DB_NAME: u.pathname.slice(1),
      FACTONET_DB_USER: u.username, FACTONET_DB_PASSWORD: u.password, FACTONET_DB_SSL: 'false',
    };
    Object.assign(process.env, env, { ACCOUNTING_CYCLONET_TENANT_ID: 'tenant-cyclonet', ACCOUNTING_CYCLONET_NAME: 'CycloNet S.A.S.', ACCOUNTING_AUTO_SYNC: 'false' });
    const mod = await Test.createTestingModule({ imports: [AccountingModule.register(env as any)] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    service = app.get(AccountingService);
    const ds = app.get(require('typeorm').DataSource);
    await ds.query('TRUNCATE acc_voucher_lines, acc_vouchers, acc_periods, acc_third_parties, acc_accounts, acc_companies CASCADE');
    close = () => app.close();
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await close?.();
  });

  it('crea la empresa con el PUC base', async () => {
    const accs = await service.listAccounts();
    expect(accs.find((a) => a.code === '130505')).toEqual(expect.objectContaining({ acceptsEntries: true, requiresThirdParty: true, nature: 'DEBITO' }));
    expect(accs.length).toBeGreaterThan(80);
  });

  it('comprobantes: consecutivo por tipo, borrador → contabilizado, reversa y cierre de mes', async () => {
    const tp = await service.saveThirdParty({ idType: '31', idNumber: '900123456', name: 'Amazon Web Services' });
    const gasto = { type: 'CE' as const, date: '2026-10-25', description: 'Factura AWS octubre', lines: [
      { accountCode: '523525', debit: 30000 },
      { accountCode: '220505', credit: 30000, thirdPartyId: tp.id },
    ] };
    const v1 = await service.createVoucher({ ...gasto, post: true }, 'admin@cyclonet.co');
    const v2 = await service.createVoucher(gasto, 'admin@cyclonet.co');
    expect([v1.number, v1.status, v2.number, v2.status]).toEqual([1, 'CONTABILIZADO', 2, 'BORRADOR']);
    await expect(service.setPeriod('2026-10', 'CERRADO', 'x')).rejects.toThrow(/borrador/);
    await service.post(v2.id);
    const rev = await service.reverse(v2.id, 'Duplicado', 'admin@cyclonet.co');
    expect(rev).toEqual(expect.objectContaining({ type: 'NC', status: 'CONTABILIZADO' }));
    expect((await service.getVoucher(v2.id)).status).toBe('ANULADO');
    await service.setPeriod('2026-10', 'CERRADO', 'admin');
    await expect(service.createVoucher({ ...gasto, post: true }, 'x')).rejects.toThrow(/cerrado/);
    await service.setPeriod('2026-10', 'ABIERTO', 'admin');
  });

  it('sincroniza facturas y pagos de Authoriza una sola vez y los reportes cuadran', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => [
      { id: 7, code: 'DF00007', value: 89000, issueDate: '2026-10-03', status: 'Paid', paymentDate: '2026-10-20', paidAmount: 105910,
        globalParameters: { iva: 16910 }, operationTypes: { iva: 'add' },
        user: { id: 'u-1', strUserName: 'pagos@jimmylon.co', basicData: { documentNumber: '1047000111', documentType: { documentType: 'CC' }, naturalPersonData: { firstName: 'Jimena', firstSurname: 'Ríos' } } } },
      { id: 8, code: 'DF00008', value: 50000, issueDate: '2026-10-05', status: 'Unconfirmed', user: { id: 'u-2' } },
    ] })) as any;
    expect(await service.syncAuthoriza()).toEqual(expect.objectContaining({ invoices: 2, created: 2 }));
    expect(await service.syncAuthoriza()).toEqual(expect.objectContaining({ created: 0 }));
    const tp = (await service.listThirdParties('Jimena'))[0];
    expect(tp).toEqual(expect.objectContaining({ idNumber: '1047000111', authorizaUserId: 'u-1' }));

    // El gasto duplicado cuenta en octubre; su reversa (fecha de hoy) lo compensa después
    const oct = await service.incomeStatement('2026-10-01', '2026-10-31');
    expect(oct).toEqual(expect.objectContaining({ ingresos: 89000, gastos: 60000, utilidad: 29000 }));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    const anio = await service.incomeStatement('2026-01-01', today);
    expect(anio).toEqual(expect.objectContaining({ ingresos: 89000, gastos: 30000, utilidad: 59000 }));
    const bs = await service.balanceSheet('2026-10-31');
    expect(bs.cuadra).toBe(true);
    const tb = await service.trialBalance('2026-10-01', '2026-10-31');
    expect(tb.totals.debit).toBe(tb.totals.credit);
    const ledger = await service.ledger('130505', '2026-10-01', '2026-10-31');
    expect(ledger.movements.map((m: any) => [m.debit, m.credit])).toEqual([[105910, 0], [0, 105910]]);
    expect(ledger.closing).toBe(0);
  });
});
