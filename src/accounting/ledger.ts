import { AccountMap, Nature, natureOf } from './puc';

/**
 * Reglas contables puras (ledger.spec.ts): validación de comprobantes de
 * partida doble, asientos automáticos desde las facturas de Authoriza y
 * reportes (balance de prueba, libro mayor, estado de resultados y estado de
 * situación financiera).
 */

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface LineInput {
  accountCode: string;
  thirdPartyId?: string | null;
  description?: string | null;
  debit?: number;
  credit?: number;
}

export interface AccountInfo {
  code: string;
  name: string;
  acceptsEntries: boolean;
  requiresThirdParty?: boolean;
  active?: boolean;
}

/** Errores de un comprobante (vacío = se puede contabilizar). */
export function validateVoucher(lines: LineInput[], accounts: Map<string, AccountInfo>): string[] {
  const e: string[] = [];
  if (!Array.isArray(lines) || lines.length < 2) return ['El comprobante necesita al menos dos movimientos.'];
  lines.forEach((l, i) => {
    const n = i + 1;
    const d = r2(l.debit || 0);
    const c = r2(l.credit || 0);
    const acc = accounts.get(String(l.accountCode || ''));
    if (!acc) e.push(`Línea ${n}: la cuenta ${l.accountCode || '(vacía)'} no existe.`);
    else {
      if (!acc.acceptsEntries) e.push(`Línea ${n}: la cuenta ${acc.code} ${acc.name} no recibe movimientos (usa una subcuenta).`);
      if (acc.active === false) e.push(`Línea ${n}: la cuenta ${acc.code} está inactiva.`);
      if (acc.requiresThirdParty && !l.thirdPartyId) e.push(`Línea ${n}: la cuenta ${acc.code} ${acc.name} exige tercero.`);
    }
    if (d < 0 || c < 0) e.push(`Línea ${n}: los valores no pueden ser negativos.`);
    if (d > 0 && c > 0) e.push(`Línea ${n}: una línea va al débito o al crédito, no a los dos.`);
    if (!(d > 0) && !(c > 0)) e.push(`Línea ${n}: escribe el valor al débito o al crédito.`);
  });
  const { debit, credit } = totals(lines);
  if (debit !== credit) e.push(`El comprobante no cuadra: débitos ${money(debit)} y créditos ${money(credit)}.`);
  return e;
}

export function totals(lines: LineInput[]) {
  return {
    debit: r2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)),
    credit: r2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)),
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

// ═══════════════════════ Asientos automáticos desde Authoriza

export interface AuthorizaInvoice {
  id: number;
  code?: string | null;
  value: number | string;
  issueDate: string;
  status: string;
  paymentDate?: string | null;
  paidAmount?: number | string | null;
  globalParameters?: Record<string, any> | null;
  operationTypes?: Record<string, string> | null;
  user?: { id?: string; strUserName?: string } | null;
  userId?: string | null;
}

export interface AutoVoucher {
  sourceKey: string;
  date: string;
  description: string;
  /** Tercero del cliente (Authoriza user id). */
  clientUserId: string | null;
  lines: (Omit<LineInput, 'thirdPartyId'> & { client?: boolean })[];
}

/**
 * Comprobantes automáticos de una factura de CycloNet (idempotentes por
 * sourceKey):
 * - EMITIDA (no borrador, valor > 0): clientes (DB) contra ingresos neto de
 *   descuentos (CR) e IVA generado (CR).
 * - PAGO (pagada): bancos (DB) contra clientes (CR) por el total; si el pago
 *   incluye intereses de mora, ese excedente va a ingresos financieros.
 * Los pagos rechazados nunca se contabilizan (vuelven a Issued sin pago).
 */
export function vouchersFromInvoice(inv: AuthorizaInvoice, map: AccountMap): AutoVoucher[] {
  const out: AutoVoucher[] = [];
  const value = r2(Number(inv.value));
  if (inv.status === 'Unconfirmed' || !(value > 0)) return out;
  const params = inv.globalParameters || {};
  const ops = inv.operationTypes || {};
  let discounts = 0;
  let iva = 0;
  for (const [k, op] of Object.entries(ops)) {
    if (k === 'late_fee_penalty') continue; // la mora se reconoce al cobrarla
    const v = r2(Number(params[k]) || 0);
    if (!v) continue;
    if (k === 'iva' && op === 'add') iva = r2(iva + v);
    else if (op === 'subtract') discounts = r2(discounts + v);
  }
  const income = r2(value - discounts);
  const total = r2(income + iva);
  const code = inv.code || `INV-${inv.id}`;
  const clientUserId = inv.user?.id || inv.userId || null;
  const issueDate = String(inv.issueDate).slice(0, 10);

  if (total > 0) {
    out.push({
      sourceKey: `AUTHORIZA:invoice:${inv.id}:EMITIDA`,
      date: issueDate,
      description: `Factura ${code}`,
      clientUserId,
      lines: [
        { accountCode: map.clientes, debit: total, client: true, description: `Factura ${code}` },
        { accountCode: map.ingresos, credit: income, description: `Servicio · factura ${code}` },
        ...(iva > 0 ? [{ accountCode: map.ivaGenerado, credit: iva, description: `IVA factura ${code}` }] : []),
      ],
    });
  }

  const paid = r2(Number(inv.paidAmount) || 0);
  if (inv.status === 'Paid' && paid > 0) {
    const toReceivable = Math.min(paid, total);
    const lateFee = r2(paid - toReceivable);
    const date = String(inv.paymentDate || inv.issueDate).slice(0, 10);
    out.push({
      sourceKey: `AUTHORIZA:invoice:${inv.id}:PAGO`,
      date,
      description: `Pago factura ${code}`,
      clientUserId,
      lines: [
        { accountCode: map.bancos, debit: paid, description: `Pago factura ${code}` },
        { accountCode: map.clientes, credit: r2(toReceivable), client: true, description: `Pago factura ${code}` },
        ...(lateFee > 0 ? [{ accountCode: map.interesesMora, credit: lateFee, description: `Intereses de mora · ${code}` }] : []),
      ],
    });
  }
  return out;
}

// ═══════════════════════ Reportes

export interface Movement {
  accountCode: string;
  debit: number;
  credit: number;
  date: string; // YYYY-MM-DD
}

export interface BalanceRow {
  code: string;
  name: string;
  level: number;
  nature: Nature;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

/**
 * Balance de prueba entre dos fechas, con saldo inicial, movimientos y saldo
 * final por cuenta, acumulado hacia los niveles superiores (clase, grupo,
 * cuenta). El saldo va en el sentido de la naturaleza de la cuenta.
 */
export function trialBalance(
  movements: Movement[],
  accounts: { code: string; name: string }[],
  from: string,
  to: string,
): BalanceRow[] {
  const names = new Map(accounts.map((a) => [a.code, a.name]));
  const rows = new Map<string, BalanceRow>();
  const ensure = (code: string): BalanceRow => {
    let r = rows.get(code);
    if (!r) {
      r = { code, name: names.get(code) || code, level: lvl(code), nature: natureOf(code), opening: 0, debit: 0, credit: 0, closing: 0 };
      rows.set(code, r);
    }
    return r;
  };
  const yearStart = `${from.slice(0, 4)}-01-01`;
  for (const m of movements) {
    if (m.date > to) continue;
    // Las cuentas de resultado (4 a 7) empiezan cada año en cero: lo de años
    // anteriores ya es resultado de ejercicios anteriores (patrimonio)
    if (m.date < yearStart && ['4', '5', '6', '7'].includes(m.accountCode[0])) continue;
    for (const code of ancestors(m.accountCode)) {
      const r = ensure(code);
      const sign = r.nature === 'DEBITO' ? 1 : -1;
      if (m.date < from) r.opening = r2(r.opening + sign * (m.debit - m.credit));
      else { r.debit = r2(r.debit + m.debit); r.credit = r2(r.credit + m.credit); }
    }
  }
  for (const r of rows.values()) {
    const sign = r.nature === 'DEBITO' ? 1 : -1;
    r.closing = r2(r.opening + sign * (r.debit - r.credit));
  }
  return [...rows.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function lvl(code: string) {
  const n = code.length;
  return n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 3 : n <= 6 ? 4 : 5;
}

/** La cuenta y sus padres: 130505 → 1, 13, 1305, 130505. */
export function ancestors(code: string): string[] {
  const out = [code.slice(0, 1)];
  if (code.length >= 2) out.push(code.slice(0, 2));
  if (code.length >= 4) out.push(code.slice(0, 4));
  if (code.length >= 6) out.push(code.slice(0, 6));
  if (code.length > 6) out.push(code);
  return [...new Set(out)];
}

/** Resultado (ingresos − gastos − costos) de los movimientos dados. */
export function resultOf(movements: Movement[]): number {
  let s = 0;
  for (const m of movements) {
    const c = m.accountCode[0];
    if (c === '4') s += m.credit - m.debit;
    else if (['5', '6', '7'].includes(c)) s -= m.debit - m.credit;
  }
  return r2(s);
}

/** Estado de resultados del periodo: ingresos (4) − gastos (5) − costos (6, 7). */
export function incomeStatement(balance: BalanceRow[]) {
  const pick = (cls: string) => balance.filter((r) => r.code[0] === cls);
  const flow = (r: BalanceRow) => r2(r.nature === 'CREDITO' ? r.credit - r.debit : r.debit - r.credit);
  const sum = (cls: string) => r2(pick(cls).filter((r) => r.level === 1).reduce((s, r) => s + flow(r), 0));
  const ingresos = sum('4');
  const gastos = sum('5');
  const costos = r2(sum('6') + sum('7'));
  return {
    ingresos, gastos, costos,
    utilidad: r2(ingresos - gastos - costos),
    detalle: balance.filter((r) => ['4', '5', '6', '7'].includes(r.code[0]) && r.level <= 3).map((r) => ({ code: r.code, name: r.name, level: r.level, valor: flow(r) })),
  };
}

/**
 * Estado de situación financiera a una fecha: activo = pasivo + patrimonio.
 * El patrimonio suma el resultado del ejercicio y el de años anteriores que aún
 * no se trasladó con el cierre anual.
 */
export function balanceSheet(balance: BalanceRow[], resultadoEjercicio: number, resultadosAnteriores = 0) {
  const top = (cls: string) => r2(balance.find((r) => r.code === cls)?.closing || 0);
  const activo = top('1');
  const pasivo = top('2');
  const patrimonio = r2(top('3') + resultadoEjercicio + resultadosAnteriores);
  return {
    activo, pasivo, patrimonio, resultadoEjercicio, resultadosAnteriores,
    cuadra: Math.abs(activo - (pasivo + patrimonio)) < 1,
    detalle: balance.filter((r) => ['1', '2', '3'].includes(r.code[0]) && r.level <= 3).map((r) => ({ code: r.code, name: r.name, level: r.level, saldo: r.closing })),
  };
}
