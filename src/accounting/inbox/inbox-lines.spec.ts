import { DEFAULT_ACCOUNT_MAP } from '../puc';
import { totals, validateVoucher } from '../ledger';
import { inboxVoucherLines } from './inbox.service';

const map = DEFAULT_ACCOUNT_MAP as any;
const doc = (o: any = {}) => ({ kind: 'Invoice', number: 'FE1', supplierName: 'Hosting Andino', base: 100000, iva: 19000, otherTaxes: 0, payable: 119000, data: { withholdings: { renta: 0, iva: 0, ica: 0 } }, ...o });

describe('Asiento de una factura de proveedor', () => {
  it('CycloNet (servicios excluidos): el IVA va al gasto, contra proveedores', () => {
    const { lines, total, warning } = inboxVoucherLines(doc(), map, '523525', 'tp-1');
    expect(lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([['523525', 119000, 0], ['220505', 0, 119000]]);
    expect(lines[1].thirdPartyId).toBe('tp-1');
    expect(total).toBe(119000);
    expect(warning).toBeNull();
  });

  it('con IVA descontable y retención en la fuente', () => {
    const { lines } = inboxVoucherLines(doc({ data: { withholdings: { renta: 4000, iva: 0, ica: 0 } } }), { ...map, ivaCompras: '240810' }, '513595', 'tp-1');
    expect(lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['513595', 100000, 0], ['240810', 19000, 0], ['236525', 0, 4000], ['220505', 0, 115000],
    ]);
    const t = totals(lines);
    expect(t.debit).toBe(t.credit);
  });

  it('una nota crédito genera el asiento contrario', () => {
    const { lines } = inboxVoucherLines(doc({ kind: 'CreditNote', base: 20000, iva: 3800, payable: 23800 }), map, '523525', 'tp-1');
    expect(lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([['523525', 0, 23800], ['220505', 23800, 0]]);
  });

  it('avisa si el total no coincide con el valor a pagar de la factura', () => {
    expect(inboxVoucherLines(doc({ payable: 100000 }), map, '523525', null).warning).toMatch(/no coincide/);
  });

  it('cuadra y respeta las reglas del PUC (proveedor exige tercero)', () => {
    const { lines } = inboxVoucherLines(doc(), map, '523525', 'tp-1');
    const accounts = new Map([
      ['523525', { code: '523525', acceptsEntries: true, requiresThirdParty: false, active: true, name: 'Nube' }],
      ['220505', { code: '220505', acceptsEntries: true, requiresThirdParty: true, active: true, name: 'Proveedores' }],
    ]) as any;
    expect(validateVoucher(lines, accounts)).toEqual([]);
  });
});
