import { Test } from '@nestjs/testing';
import JSZip = require('jszip');
import { AccountingModule } from '../accounting.module';
import { AccountingService } from '../accounting.service';
import { InboxService } from './inbox.service';
import { attachedDocumentXml } from './fixtures';

/**
 * Bandeja de facturas recibidas contra un Postgres real (no corre en la suite normal).
 * Uso: ACCOUNTING_TEST_DB=postgres://postgres:test@localhost:55432/factonet_test npx jest src/accounting/inbox/inbox.int-spec.ts --testRegex int-spec
 */
const url = process.env.ACCOUNTING_TEST_DB;
const d = url ? describe : describe.skip;

/** Correo MIME como lo guarda SES en S3, con el ZIP del proveedor adjunto. */
async function email(o: Parameters<typeof attachedDocumentXml>[0] = {}, withXml = true): Promise<Buffer> {
  const zip = new JSZip();
  if (withXml) zip.file(`ad${o.number || 'FE1234'}.xml`, attachedDocumentXml(o));
  zip.file(`ad${o.number || 'FE1234'}.pdf`, Buffer.from('%PDF-1.4 factura de prueba'));
  const b64 = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64').replace(/(.{76})/g, '$1\r\n');
  return Buffer.from([
    'From: Hosting Andino <facturas@hosting.example>', 'To: cyclonet@facturas.cyclonet.com.co', `Subject: 900111222;Hosting Andino;${o.number || 'FE1234'};01;Hosting Andino`,
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=utf-8', '', 'Adjuntamos su factura electrónica.', '',
    '--b1', `Content-Type: application/zip; name="z${o.number || 'FE1234'}.zip"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="z${o.number || 'FE1234'}.zip"`, '', b64, '--b1--', '',
  ].join('\r\n'));
}

d('Facturas recibidas · integración (Postgres)', () => {
  let acc: AccountingService;
  let inbox: InboxService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const u = new URL(url!);
    const env = { FACTONET_DB_HOST: u.hostname, FACTONET_DB_PORT: u.port, FACTONET_DB_NAME: u.pathname.slice(1), FACTONET_DB_USER: u.username, FACTONET_DB_PASSWORD: u.password, FACTONET_DB_SSL: 'false' };
    Object.assign(process.env, env, { ACCOUNTING_CYCLONET_TENANT_ID: 'tenant-cyclonet', ACCOUNTING_CYCLONET_NIT: '901515884-3', ACCOUNTING_AUTO_SYNC: 'false' });
    const mod = await Test.createTestingModule({ imports: [AccountingModule.register(env as any)] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    acc = app.get(AccountingService);
    inbox = app.get(InboxService);
    const ds = app.get(require('typeorm').DataSource);
    await ds.query('TRUNCATE acc_inbox_documents, acc_supplier_rules, acc_voucher_lines, acc_vouchers, acc_periods, acc_third_parties, acc_accounts, acc_companies CASCADE');
    close = () => app.close();
  });
  afterAll(async () => close?.());

  it('recibe la factura del correo, detecta duplicadas, ajenas y las que llegan sin XML', async () => {
    const [ok] = await inbox.ingestRawEmail(await email());
    expect(ok).toEqual(expect.objectContaining({ status: 'PENDIENTE', number: 'FE1234', supplierName: 'Hosting Andino S.A.S.' }));
    const doc = await inbox.get(ok.id);
    expect(doc).toEqual(expect.objectContaining({ fromAddress: expect.stringContaining('facturas@hosting.example'), pdfName: 'adFE1234.pdf', accountCode: null }));
    expect((await acc.listThirdParties('Hosting'))[0]).toEqual(expect.objectContaining({ idNumber: '900111222', idType: '31' }));

    expect((await inbox.ingestRawEmail(await email()))[0].status).toBe('DUPLICADA');
    expect((await inbox.ingestRawEmail(await email({ number: 'FE77', cufe: 'otro', customerNit: '800999111' })))[0]).toEqual(expect.objectContaining({ status: 'RECHAZADA', message: expect.stringMatching(/800999111/) }));
    expect((await inbox.ingestRawEmail(await email({ number: 'FE88' }, false)))[0].status).toBe('SIN_XML');
    expect((await inbox.pdf(ok.id)).data.toString()).toContain('%PDF');
  });

  it('al aprobar se contabiliza una sola vez y la cuenta queda como regla del proveedor', async () => {
    const [pend] = await inbox.list('PENDIENTE');
    const { voucher } = await inbox.approve(pend.id, { accountCode: '523525', saveRule: true }, 'admin@cyclonet.test');
    expect(voucher).toEqual(expect.objectContaining({ type: 'NC', status: 'CONTABILIZADO', date: '2026-11-05' }));
    await expect(inbox.approve(pend.id, { accountCode: '523525' }, 'x')).rejects.toThrow(/pendientes/);

    const er = await acc.incomeStatement('2026-11-01', '2026-11-30');
    expect(er.gastos).toBe(119000);
    const ledger = await acc.ledger('220505', '2026-11-01', '2026-11-30');
    expect(ledger.closing).toBe(119000);

    const [next] = await inbox.ingestRawEmail(await email({ number: 'FE1300', cufe: 'cufe-1300', base: 50000, iva: 9500, reteRenta: 2000 }));
    expect((await inbox.get(next.id)).accountCode).toBe('523525');
    expect((await inbox.get(next.id)).preview?.lines.map((l: any) => [l.accountCode, l.debit, l.credit])).toEqual([['523525', 59500, 0], ['236525', 0, 2000], ['220505', 0, 57500]]);
  });

  it('agrega al PUC de una empresa existente las cuentas nuevas (retenciones de IVA e ICA)', async () => {
    const codes = (await acc.listAccounts()).map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['236705', '236805']));
  });
});
