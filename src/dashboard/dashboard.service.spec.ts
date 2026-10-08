import { DashboardService } from './dashboard.service';

/** 8 de octubre de 2026, 9:00 p. m. en Bogotá (ya es el 9 en UTC). */
const AHORA = new Date('2026-10-09T02:00:00Z');

const f = (id: number, estado: string, fechaVencimiento: string, o: any = {}) => ({
  id, numero: `DF${id}`, cliente: o.cliente || 'Cliente A', estado, fechaEmision: '2026-10-01', fechaVencimiento,
  total: 89000, iva: 16910, operationTypes: { iva: 'add' }, ...o,
});

function montar(facturas: any[]) {
  const invoices: any = { findAll: jest.fn(async () => facturas) };
  const contracts: any = { findAll: jest.fn(async () => []) };
  return new DashboardService(invoices, contracts);
}

describe('DashboardService', () => {
  beforeEach(() => jest.useFakeTimers({ now: AHORA }));
  afterEach(() => jest.useRealTimers());

  it('los montos usan el TOTAL (valor + IVA), el mismo de Facturas', async () => {
    const o = await montar([f(1, 'Issued', '2026-10-20'), f(2, 'In arrears', '2026-10-02')]).getOverview('t', 'adminInvoices');
    expect(o.kpis.openValue).toBe(211820);
    expect(o.kpis.openCount).toBe(2);
    expect(o.overdueInvoices[0].total).toBe(105910);
  });

  it('una factura que vence hoy no está vencida aunque en UTC ya sea mañana', async () => {
    const o = await montar([f(1, 'Issued', '2026-10-08')]).getOverview('t', 'adminInvoices');
    expect(o.kpis.overdueCount).toBe(0);
    expect(o.kpis.dueSoonCount).toBe(1);
  });

  it('una emitida cuya fecha ya pasó cuenta como vencida; una con pago reportado no', async () => {
    const o = await montar([f(1, 'Issued', '2026-10-07'), f(2, 'Payment Reported', '2026-10-01')]).getOverview('t', 'adminInvoices');
    expect(o.kpis.overdueCount).toBe(1);
    expect(o.kpis.reportedCount).toBe(1);
  });

  it('por vencer: hasta 7 días', async () => {
    const o = await montar([f(1, 'Issued', '2026-10-15'), f(2, 'Issued', '2026-10-16')]).getOverview('t', 'adminInvoices');
    expect(o.dueSoonInvoices.map((i: any) => i.id)).toEqual([1]);
  });

  it('mayores deudores solo para el administrador', async () => {
    const facturas = [f(1, 'Issued', '2026-10-20', { cliente: 'A' }), f(2, 'Issued', '2026-10-20', { cliente: 'B', total: 10000, iva: 0 })];
    expect((await montar(facturas).getOverview('t', 'adminInvoices')).topDebtors).toEqual([]);
    const admin = await montar(facturas).getOverview(undefined, 'adminFactonet');
    expect(admin.topDebtors.map((d: any) => [d.name, d.balance])).toEqual([['A', 105910], ['B', 10000]]);
  });

  it('recaudado del mes: pagadas con fecha de pago en el mes', async () => {
    const o = await montar([f(1, 'Paid', '2026-10-05', { fechaPago: '2026-10-04' }), f(2, 'Paid', '2026-09-05', { fechaPago: '2026-09-04' })])
      .getOverview(undefined, 'adminFactonet');
    expect(o.kpis.collectedMonth).toBe(105910);
    expect(o.kpis.collectedPrevMonth).toBe(105910);
  });
});
