import { Injectable } from '@nestjs/common';
import { InvoicesService } from '../invoices/invoices.service';
import { ContractsService } from '../contracts/contracts.service';
import { totalAPagar } from '../pagos/total-factura';

/** Colombia no tiene horario de verano: UTC-5 fijo. */
const OFFSET = 5 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const monthStart = (now: Date, delta = 0) => {
  const l = new Date(now.getTime() - OFFSET);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + delta, 1) + OFFSET);
};
const key = (d: Date) => new Date(d.getTime() - OFFSET).toISOString().slice(0, 7);
const num = (v: any) => Number(v) || 0;
const date = (v: any): Date | null => (v ? new Date(v) : null);
/** 'YYYY-MM-DD' de hoy en Bogotá. */
const todayKey = (now: Date) => new Date(now.getTime() - OFFSET).toISOString().slice(0, 10);
/** Días de calendario entre hoy (Bogotá) y una fecha 'YYYY-MM-DD'; negativo si ya pasó. */
const daysUntil = (v: any, now: Date): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  if (!m) return null;
  const t = todayKey(now);
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10))) / DAY);
};
/** TOTAL de la factura (valor ± IVA, descuentos y mora), el mismo de la pantalla, el PDF y la pasarela. */
const valor = (i: any) => totalAPagar(i);

/** Estados de factura que ya se le cobran al cliente (no borrador, no pagada). */
const OPEN = ['Issued', 'In arrears', 'Notification1', 'Notification2', 'Suspended', 'Payment Reported'];
const OVERDUE = ['In arrears', 'Notification1', 'Notification2', 'Suspended'];

/**
 * Resumen del Dashboard de FactoNet con el mismo alcance que las listas:
 * adminFactonet ve todo el ecosistema; adminInvoices (cliente) solo lo suyo.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly contracts: ContractsService,
  ) {}

  async getOverview(tenantId?: string, rol?: string, auth?: string) {
    const now = new Date();
    const isAdmin = rol === 'adminFactonet';
    const [invoices, contracts] = await Promise.all([
      this.invoices.findAll(tenantId, rol),
      this.contracts.findAll(tenantId, rol, auth).catch(() => []),
    ]);
    const m0 = monthStart(now), m1 = monthStart(now, -1), m5 = monthStart(now, -5);
    const between = (d: Date | null, a: Date, b: Date) => !!d && d >= a && d < b;
    const end = new Date(now.getTime() + 1);

    const paid = invoices.filter((i: any) => i.estado === 'Paid');
    const open = invoices.filter((i: any) => OPEN.includes(i.estado));
    // Vencida = su fecha de vencimiento ya pasó en Bogotá. Antes se comparaba
    // new Date('YYYY-MM-DD') (medianoche UTC = 7 p. m. del día anterior en
    // Colombia) con la hora actual y se marcaba vencida la noche anterior.
    const overdue = open.filter((i: any) => OVERDUE.includes(i.estado) || ((daysUntil(i.fechaVencimiento, now) ?? 0) < 0 && i.estado !== 'Payment Reported'));
    const reported = invoices.filter((i: any) => i.estado === 'Payment Reported');
    const unconfirmed = invoices.filter((i: any) => i.estado === 'Unconfirmed');
    const dueSoon = open.filter((i: any) => {
      const d = daysUntil(i.fechaVencimiento, now);
      return d !== null && d >= 0 && d <= 7 && !overdue.includes(i);
    });
    // Antes sumaba i.total (valor sin IVA ni conceptos): "Por pagar" no
    // coincidía con el total de Facturas.
    const sum = (l: any[]) => l.reduce((s, i) => s + valor(i), 0);
    const billed = (a: Date, b: Date) => invoices.filter((i: any) => i.estado !== 'Unconfirmed' && between(date(i.fechaEmision), a, b));
    const collected = (a: Date, b: Date) => paid.filter((i: any) => between(date(i.fechaPago) || date(i.fechaEmision), a, b));

    // Serie de 6 meses: facturado vs recaudado
    const months: { key: string; label: string; billed: number; collected: number }[] = [];
    for (let k = 5; k >= 0; k--) {
      const s = monthStart(now, -k);
      months.push({ key: key(s), label: new Intl.DateTimeFormat('es-CO', { month: 'short', timeZone: 'America/Bogota' }).format(s).replace('.', ''), billed: 0, collected: 0 });
    }
    const byMonth = new Map(months.map((m) => [m.key, m]));
    for (const i of invoices) {
      const e = date(i.fechaEmision);
      if (i.estado !== 'Unconfirmed' && e && e >= m5) { const m = byMonth.get(key(e)); if (m) m.billed += valor(i); }
      const p = i.estado === 'Paid' ? date(i.fechaPago) || e : null;
      if (p && p >= m5) { const m = byMonth.get(key(p)); if (m) m.collected += valor(i); }
    }

    // Estados (para la distribución)
    const statusCount: Record<string, number> = {};
    for (const i of invoices) statusCount[i.estado] = (statusCount[i.estado] || 0) + 1;

    // Clientes con mayor saldo (solo admin)
    const debt = new Map<string, { name: string; balance: number; overdue: number; count: number }>();
    for (const i of open) {
      const c = debt.get(i.cliente) || { name: i.cliente, balance: 0, overdue: 0, count: 0 };
      c.balance += valor(i); c.count++;
      if (overdue.includes(i)) c.overdue += valor(i);
      debt.set(i.cliente, c);
    }

    // Contratos
    const active = contracts.filter((c: any) => c.status === 'ACTIVE');
    const pendingAdminSign = contracts.filter((c: any) => c.clientSignedAt && !c.adminSignedAt && c.status !== 'ACTIVE');
    const pendingClientSign = contracts.filter((c: any) => c.status === 'PENDING' && c.issuedAt && !c.clientSignedAt);
    const needsPdf = contracts.filter((c: any) => c.status === 'PENDING' && !c.pdfUrl);
    const needsIssue = contracts.filter((c: any) => c.status === 'PENDING' && c.pdfUrl && !c.issuedAt);

    const invoiceRow = (i: any) => ({ id: i.id, numero: i.numero, cliente: i.cliente, total: valor(i), estado: i.estado, vence: i.fechaVencimiento });
    const billedMonth = sum(billed(m0, end));
    const collectedMonth = sum(collected(m0, end));

    return {
      generatedAt: now.toISOString(),
      scope: isAdmin ? 'admin' : 'client',
      kpis: {
        billedMonth, billedPrevMonth: sum(billed(m1, m0)),
        collectedMonth, collectedPrevMonth: sum(collected(m1, m0)),
        openValue: sum(open), openCount: open.length,
        overdueValue: sum(overdue), overdueCount: overdue.length,
        dueSoonValue: sum(dueSoon), dueSoonCount: dueSoon.length,
        reportedCount: reported.length, reportedValue: sum(reported),
        unconfirmedCount: unconfirmed.length,
        paidYear: sum(paid.filter((i: any) => (date(i.fechaPago) || date(i.fechaEmision))!.getFullYear() === now.getFullYear())),
        collectionRate: billed(m0, end).length ? Math.round((billed(m0, end).filter((i: any) => i.estado === 'Paid').length / billed(m0, end).length) * 100) : null,
        totalInvoices: invoices.length,
        activeContracts: active.length,
        totalContracts: contracts.length,
        // contract.value guarda el valor ANUAL del contrato
        mrr: Math.round(active.reduce((s: number, c: any) => s + num(c.value), 0) / 12),
      },
      contractsPending: {
        adminSignature: pendingAdminSign.map((c: any) => ({ id: c.id, code: c.code })),
        clientSignature: pendingClientSign.map((c: any) => ({ id: c.id, code: c.code })),
        needsPdf: needsPdf.map((c: any) => ({ id: c.id, code: c.code })),
        needsIssue: needsIssue.map((c: any) => ({ id: c.id, code: c.code })),
      },
      statusCount,
      months,
      overdueInvoices: overdue.sort((a: any, b: any) => +new Date(a.fechaVencimiento) - +new Date(b.fechaVencimiento)).slice(0, 5).map(invoiceRow),
      dueSoonInvoices: dueSoon.sort((a: any, b: any) => +new Date(a.fechaVencimiento) - +new Date(b.fechaVencimiento)).slice(0, 5).map(invoiceRow),
      reportedInvoices: reported.slice(0, 5).map(invoiceRow),
      topDebtors: isAdmin ? [...debt.values()].sort((a, b) => b.balance - a.balance).slice(0, 5) : [],
      recentInvoices: [...invoices].filter((i: any) => i.estado !== 'Unconfirmed' || isAdmin)
        .sort((a: any, b: any) => +new Date(b.fechaEmision) - +new Date(a.fechaEmision)).slice(0, 8).map(invoiceRow),
    };
  }

  /** Conteos para las notificaciones del encabezado (antes eran valores fijos de ejemplo). */
  async getMetrics(tenantId?: string, rol?: string, auth?: string) {
    const o = await this.getOverview(tenantId, rol, auth);
    return {
      pendingInvoices: o.kpis.openCount,
      paidInvoices: o.statusCount['Paid'] || 0,
      totalContracts: o.kpis.totalContracts,
      activeContracts: o.kpis.activeContracts,
      totalRevenue: o.kpis.paidYear,
      monthlyRevenue: o.kpis.collectedMonth,
    };
  }
}
