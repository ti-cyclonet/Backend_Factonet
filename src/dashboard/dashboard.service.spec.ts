import { DashboardService } from './dashboard.service';

/** 8 de octubre de 2026, 9:00 p. m. en Bogotá (ya es el 9 en UTC). */
const AHORA = new Date('2026-10-09T02:00:00Z');

const f = (id: number, estado: string, fechaVencimiento: string, o: any = {}) => ({
  id, numero: `DF${id}`, cliente: o.cliente || 'Cliente A', estado, fechaEmision: '2026-10-01', fechaVencimiento,
  total: 89000, iva: 16910, operationTypes: { iva: 'add' }, ...o,
});

const k = (id: string, status: string, o: any = {}) => ({
  id, code: `CT-${id}`, status, value: 1200000, mode: 'MONTHLY', startDate: '2026-05-01', endDate: null,
  createdAt: '2026-05-01T15:00:00Z', updatedAt: '2026-05-01T15:00:00Z', package: { name: 'PRO' },
  user: { basicData: { legalEntityData: { businessName: `Empresa ${id}` } } }, ...o,
});

function montar(facturas: any[], contratos: any[] = []) {
  const invoices: any = { findAll: jest.fn(async () => facturas) };
  const contracts: any = { findAll: jest.fn(async () => contratos) };
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

  describe('contratos (administrador)', () => {
    const contratos = [
      k('a', 'ACTIVE', { endDate: '2026-10-20' }),
      k('b', 'ACTIVE', { package: { name: 'FREE' }, value: 0 }),
      k('c', 'PENDING', { startDate: '2026-10-05', createdAt: '2026-10-05T15:00:00Z' }),
      k('d', 'CANCELLED', { updatedAt: '2026-09-10T15:00:00Z' }),
      k('e', 'DELETED'),
    ];

    it('activos, ingreso recurrente, en firma y por vencer en 30 días', async () => {
      const c = (await montar([], contratos).getOverview(undefined, 'adminFactonet')).contracts!;
      expect(c.kpis).toMatchObject({ total: 4, active: 2, inProcess: 1, newThisMonth: 1, mrr: 100000, arr: 1200000, expiringCount: 1, expiringMrr: 100000 });
      expect(c.expiring.map((x: any) => [x.code, x.dias, x.cliente])).toEqual([['CT-a', 12, 'Empresa a']]);
    });

    it('por paquete, por estado y altas/bajas por mes', async () => {
      const c = (await montar([], contratos).getOverview(undefined, 'adminFactonet')).contracts!;
      expect(c.byPackage.map((p: any) => [p.name, p.active, p.mrr])).toEqual([['PRO', 1, 100000], ['FREE', 1, 0]]);
      expect(c.statusCount).toMatchObject({ ACTIVE: 2, PENDING: 1, CANCELLED: 1 });
      const m = Object.fromEntries(c.months.map((x: any) => [x.key, [x.started, x.ended]]));
      expect(m['2026-05']).toEqual([3, 0]);
      expect(m['2026-09']).toEqual([0, 1]);
      expect(m['2026-10']).toEqual([1, 0]);
      expect(c.ids).not.toContain('e');
    });

    it('el cliente no recibe el bloque de contratos', async () => {
      const o = await montar([f(1, 'Issued', '2026-10-20')], contratos).getOverview('t', 'adminInvoices');
      expect(o.contracts).toBeNull();
      expect(o.invoiceIds).toEqual([1]);
    });
  });
});
