import { ancestors, balanceSheet, incomeStatement, resultOf, trialBalance, validateVoucher, vouchersFromInvoice } from './ledger';
import { DEFAULT_ACCOUNT_MAP, PUC_BASE, levelOf, natureOf, parentOf } from './puc';

const accounts = new Map(PUC_BASE.map((a) => [a.code, a]));

describe('Contabilidad · PUC', () => {
  it('naturaleza, nivel y padre según el código', () => {
    expect(natureOf('130505')).toBe('DEBITO');
    expect(natureOf('240805')).toBe('CREDITO');
    expect(natureOf('415595')).toBe('CREDITO');
    expect(natureOf('523525')).toBe('DEBITO');
    expect([levelOf('1'), levelOf('13'), levelOf('1305'), levelOf('130505'), levelOf('13050501')]).toEqual([1, 2, 3, 4, 5]);
    expect([parentOf('13'), parentOf('1305'), parentOf('130505'), parentOf('13050501'), parentOf('1')]).toEqual(['1', '13', '1305', '130505', null]);
    expect(ancestors('130505')).toEqual(['1', '13', '1305', '130505']);
  });

  it('el PUC base trae los padres de cada cuenta y las del mapa de asientos', () => {
    for (const a of PUC_BASE) {
      const p = parentOf(a.code);
      if (p) expect(accounts.has(p)).toBe(true);
    }
    for (const code of Object.values(DEFAULT_ACCOUNT_MAP)) expect(accounts.get(code)?.acceptsEntries).toBe(true);
  });
});

describe('Contabilidad · comprobantes', () => {
  it('cuadra, usa subcuentas y exige tercero donde corresponde', () => {
    const ok = [{ accountCode: '111005', debit: 100 }, { accountCode: '130505', credit: 100, thirdPartyId: 't1' }];
    expect(validateVoucher(ok, accounts)).toEqual([]);
    expect(validateVoucher([{ accountCode: '111005', debit: 100 }, { accountCode: '130505', credit: 90, thirdPartyId: 't1' }], accounts).join(' ')).toMatch(/no cuadra/);
    expect(validateVoucher([{ accountCode: '1110', debit: 100 }, { accountCode: '130505', credit: 100, thirdPartyId: 't1' }], accounts).join(' ')).toMatch(/no recibe movimientos/);
    expect(validateVoucher([{ accountCode: '111005', debit: 100 }, { accountCode: '130505', credit: 100 }], accounts).join(' ')).toMatch(/exige tercero/);
    expect(validateVoucher([{ accountCode: '999999', debit: 1 }, { accountCode: '111005', credit: 1 }], accounts).join(' ')).toMatch(/no existe/);
    expect(validateVoucher([{ accountCode: '111005', debit: 5, credit: 5 }, { accountCode: '110505', debit: 0 }], accounts).length).toBeGreaterThan(0);
    expect(validateVoucher([{ accountCode: '111005', debit: 1 }], accounts)).toEqual(['El comprobante necesita al menos dos movimientos.']);
  });
});

describe('Contabilidad · asientos automáticos de las facturas de CycloNet', () => {
  const base = { id: 7, code: 'DF00007', value: 89000, issueDate: '2026-10-03', user: { id: 'u1' } };

  it('factura emitida: clientes contra ingresos (neto de descuentos) e IVA; la mora no se causa al emitir', () => {
    const [emitida] = vouchersFromInvoice({ ...base, status: 'Issued', globalParameters: { iva: 16910, global_discount: 1000, late_fee_penalty: 500 }, operationTypes: { iva: 'add', global_discount: 'subtract', late_fee_penalty: 'add' } }, DEFAULT_ACCOUNT_MAP);
    expect(emitida.sourceKey).toBe('AUTHORIZA:invoice:7:EMITIDA');
    expect(emitida.lines).toEqual([
      expect.objectContaining({ accountCode: '130505', debit: 104910, client: true }),
      expect.objectContaining({ accountCode: '415595', credit: 88000 }),
      expect.objectContaining({ accountCode: '240805', credit: 16910 }),
    ]);
    expect(validateVoucher(emitida.lines.map((l) => ({ ...l, thirdPartyId: l.client ? 't1' : null })), accounts)).toEqual([]);
  });

  it('pagada: también el pago a bancos; si incluyó mora, el excedente es ingreso financiero', () => {
    const v = vouchersFromInvoice({ ...base, status: 'Paid', paymentDate: '2026-10-20', paidAmount: 90500 }, DEFAULT_ACCOUNT_MAP);
    expect(v.map((x) => x.sourceKey)).toEqual(['AUTHORIZA:invoice:7:EMITIDA', 'AUTHORIZA:invoice:7:PAGO']);
    expect(v[1].date).toBe('2026-10-20');
    expect(v[1].lines).toEqual([
      expect.objectContaining({ accountCode: '111005', debit: 90500 }),
      expect.objectContaining({ accountCode: '130505', credit: 89000, client: true }),
      expect.objectContaining({ accountCode: '421005', credit: 1500 }),
    ]);
  });

  it('borradores, facturas en $0 (meses gratis) y pagos no confirmados no se contabilizan', () => {
    expect(vouchersFromInvoice({ ...base, status: 'Unconfirmed' }, DEFAULT_ACCOUNT_MAP)).toEqual([]);
    expect(vouchersFromInvoice({ ...base, value: 0, status: 'Paid', paidAmount: 0 }, DEFAULT_ACCOUNT_MAP)).toEqual([]);
    expect(vouchersFromInvoice({ ...base, status: 'Payment Reported', paidAmount: 89000 }, DEFAULT_ACCOUNT_MAP)).toHaveLength(1);
  });
});

describe('Contabilidad · reportes', () => {
  const movs = [
    // Año anterior: capital y una venta
    { accountCode: '111005', debit: 1_000_000, credit: 0, date: '2025-12-01' },
    { accountCode: '310505', debit: 0, credit: 1_000_000, date: '2025-12-01' },
    { accountCode: '130505', debit: 100_000, credit: 0, date: '2025-12-10' },
    { accountCode: '415595', debit: 0, credit: 100_000, date: '2025-12-10' },
    // Este año: venta con IVA, cobro y un gasto
    { accountCode: '130505', debit: 119_000, credit: 0, date: '2026-10-03' },
    { accountCode: '415595', debit: 0, credit: 100_000, date: '2026-10-03' },
    { accountCode: '240805', debit: 0, credit: 19_000, date: '2026-10-03' },
    { accountCode: '111005', debit: 119_000, credit: 0, date: '2026-10-20' },
    { accountCode: '130505', debit: 0, credit: 119_000, date: '2026-10-20' },
    { accountCode: '523525', debit: 30_000, credit: 0, date: '2026-10-25' },
    { accountCode: '111005', debit: 0, credit: 30_000, date: '2026-10-25' },
  ];
  const accs = PUC_BASE.map((a) => ({ code: a.code, name: a.name }));

  it('balance de prueba: saldo inicial, movimientos y saldo final por nivel; resultados empiezan el año en cero', () => {
    const tb = trialBalance(movs, accs, '2026-10-01', '2026-10-31');
    const row = (c: string) => tb.find((r) => r.code === c)!;
    expect(row('111005')).toEqual(expect.objectContaining({ opening: 1_000_000, debit: 119_000, credit: 30_000, closing: 1_089_000 }));
    expect(row('11')).toEqual(expect.objectContaining({ closing: 1_089_000 }));
    expect(row('130505')).toEqual(expect.objectContaining({ opening: 100_000, closing: 100_000 }));
    expect(row('415595')).toEqual(expect.objectContaining({ opening: 0, credit: 100_000, closing: 100_000 }));
    const l1 = tb.filter((r) => r.level === 1);
    expect(l1.reduce((s, r) => s + r.debit, 0)).toBe(l1.reduce((s, r) => s + r.credit, 0));
  });

  it('estado de resultados y estado de situación financiera que cuadra', () => {
    const tb = trialBalance(movs, accs, '2026-01-01', '2026-10-31');
    const er = incomeStatement(tb);
    expect(er).toEqual(expect.objectContaining({ ingresos: 100_000, gastos: 30_000, costos: 0, utilidad: 70_000 }));
    const ejercicio = resultOf(movs.filter((m) => m.date >= '2026-01-01'));
    const anteriores = resultOf(movs.filter((m) => m.date < '2026-01-01'));
    expect([ejercicio, anteriores]).toEqual([70_000, 100_000]);
    const bs = balanceSheet(tb, ejercicio, anteriores);
    expect(bs).toEqual(expect.objectContaining({ activo: 1_189_000, pasivo: 19_000, patrimonio: 1_170_000, cuadra: true }));
  });
});
