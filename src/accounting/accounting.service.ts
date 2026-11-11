import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, ILike, In, Repository } from 'typeorm';
import { AccAccount, AccCompany, AccPeriod, AccThirdParty, AccVoucher, AccVoucherLine } from './entities';
import { AccountMap, DEFAULT_ACCOUNT_MAP, PUC_BASE, levelOf, natureOf, parentOf } from './puc';
import { LineInput, Movement, balanceSheet, incomeStatement, resultOf, totals, trialBalance, validateVoucher, vouchersFromInvoice } from './ledger';
import { authorizaInternalHeaders } from '../common/authoriza-internal';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** Datos para insertar un comprobante (manual, automático o reversa). */
interface NewVoucher {
  type: AccVoucher['type'];
  date: string;
  description: string;
  status?: AccVoucher['status'];
  sourceKey?: string | null;
  reversalOfId?: string | null;
  lines: LineInput[];
}

export interface VoucherInput {
  type: 'CI' | 'CE' | 'NC';
  date: string;
  description: string;
  lines: LineInput[];
  /** true = se contabiliza de una vez; false = queda en borrador. */
  post?: boolean;
}

/**
 * Contabilidad de CycloNet en FactoNet (etapa 1). La empresa se crea sola
 * (ACCOUNTING_CYCLONET_TENANT_ID) con el PUC base, y las facturas y pagos de
 * CycloNet en Authoriza se contabilizan solos (syncAuthoriza).
 */
@Injectable()
export class AccountingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountingService.name);
  private readonly authorizaUrl = (process.env.AUTHORIZA_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(AccCompany) private readonly companies: Repository<AccCompany>,
    @InjectRepository(AccAccount) private readonly accounts: Repository<AccAccount>,
    @InjectRepository(AccThirdParty) private readonly thirdParties: Repository<AccThirdParty>,
    @InjectRepository(AccVoucher) private readonly vouchers: Repository<AccVoucher>,
    @InjectRepository(AccVoucherLine) private readonly lines: Repository<AccVoucherLine>,
    @InjectRepository(AccPeriod) private readonly periods: Repository<AccPeriod>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    // Asientos automáticos: cada 30 minutos (ACCOUNTING_AUTO_SYNC=false lo apaga)
    if (process.env.ACCOUNTING_AUTO_SYNC === 'false' || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => this.syncAuthoriza().catch((e) => this.logger.warn(`Sincronización contable: ${e.message}`)), 30 * 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ═══════════════════════ Empresa y plan de cuentas

  /** Empresa de CycloNet (se crea con el PUC base la primera vez). */
  async company(): Promise<AccCompany> {
    const tenantId = (process.env.ACCOUNTING_CYCLONET_TENANT_ID || '').trim();
    if (!tenantId) throw new BadRequestException('Falta ACCOUNTING_CYCLONET_TENANT_ID: la empresa de CycloNet no está configurada.');
    let c = await this.companies.findOne({ where: { tenantId } });
    if (!c) {
      c = await this.companies.save(this.companies.create({
        tenantId,
        name: process.env.ACCOUNTING_CYCLONET_NAME || 'CycloNet S.A.S.',
        nit: process.env.ACCOUNTING_CYCLONET_NIT || null,
        accountMap: { ...DEFAULT_ACCOUNT_MAP },
        autoFrom: isDate(process.env.ACCOUNTING_AUTO_FROM) ? process.env.ACCOUNTING_AUTO_FROM! : null,
      }));
      await this.seedPuc(c.id);
      this.pucSynced.add(c.id);
      this.logger.log(`Empresa contable creada: ${c.name} (PUC base cargado)`);
    }
    if (!this.pucSynced.has(c.id)) {
      await this.addMissingPucAccounts(c.id);
      this.pucSynced.add(c.id);
    }
    return c;
  }

  /** Empresas a las que ya se les revisó el PUC en este proceso. */
  private readonly pucSynced = new Set<string>();

  /** Cuentas del PUC base que se agregaron después de crear la empresa (p. ej. retenciones de IVA e ICA). */
  private async addMissingPucAccounts(companyId: string) {
    const have = new Set((await this.accounts.find({ where: { companyId }, select: ['code'] })).map((a) => a.code));
    const missing = PUC_BASE.filter((a) => !have.has(a.code));
    if (!missing.length) return;
    await this.accounts.save(missing.map((a) => this.accounts.create({
      companyId, code: a.code, name: a.name, nature: natureOf(a.code), level: levelOf(a.code),
      parentCode: parentOf(a.code), acceptsEntries: a.acceptsEntries, requiresThirdParty: !!a.requiresThirdParty, active: true,
    })));
    this.logger.log(`PUC: ${missing.length} cuenta(s) nueva(s) agregada(s) (${missing.map((a) => a.code).join(', ')})`);
  }

  /** Mapa de cuentas de la empresa, con los valores por defecto para lo que no tenga. */
  accountMapOf(c: AccCompany): Required<AccountMap> {
    return { ...DEFAULT_ACCOUNT_MAP, ...(c.accountMap || {}) } as Required<AccountMap>;
  }

  private async seedPuc(companyId: string) {
    await this.accounts.save(PUC_BASE.map((a) => this.accounts.create({
      companyId, code: a.code, name: a.name, nature: natureOf(a.code), level: levelOf(a.code),
      parentCode: parentOf(a.code), acceptsEntries: a.acceptsEntries, requiresThirdParty: !!a.requiresThirdParty, active: true,
    })));
  }

  async listAccounts() {
    const c = await this.company();
    return this.accounts.find({ where: { companyId: c.id }, order: { code: 'ASC' } });
  }

  /** Nueva subcuenta (6 dígitos) o auxiliar (8+) bajo una cuenta existente. */
  async createAccount(input: { code: string; name: string; requiresThirdParty?: boolean }) {
    const c = await this.company();
    const code = String(input.code || '').trim();
    if (!/^\d{6,10}$/.test(code) || code.length % 2) throw new BadRequestException('El código debe tener 6, 8 o 10 dígitos (subcuenta o auxiliar).');
    if (!String(input.name || '').trim()) throw new BadRequestException('Escribe el nombre de la cuenta.');
    const parentCode = parentOf(code)!;
    const parent = await this.accounts.findOne({ where: { companyId: c.id, code: parentCode } });
    if (!parent) throw new BadRequestException(`No existe la cuenta padre ${parentCode}.`);
    if (await this.accounts.findOne({ where: { companyId: c.id, code } })) throw new BadRequestException(`La cuenta ${code} ya existe.`);
    // Si el padre tenía movimientos no puede volverse cuenta de mayor
    if (parent.acceptsEntries && (await this.lines.count({ where: { companyId: c.id, accountCode: parent.code } }))) {
      throw new BadRequestException(`La cuenta ${parent.code} ya tiene movimientos: no se le pueden crear auxiliares.`);
    }
    parent.acceptsEntries = false;
    await this.accounts.save(parent);
    return this.accounts.save(this.accounts.create({
      companyId: c.id, code, name: input.name.trim().slice(0, 200), nature: natureOf(code), level: levelOf(code),
      parentCode, acceptsEntries: true, requiresThirdParty: !!input.requiresThirdParty, active: true,
    }));
  }

  // ═══════════════════════ Terceros

  async listThirdParties(q?: string) {
    const c = await this.company();
    const where = q ? [{ companyId: c.id, name: ILike(`%${q}%`) }, { companyId: c.id, idNumber: ILike(`%${q}%`) }] : { companyId: c.id };
    return this.thirdParties.find({ where: where as any, order: { name: 'ASC' }, take: 200 });
  }

  async saveThirdParty(input: { idType?: string; idNumber: string; name: string; email?: string }) {
    const c = await this.company();
    const idNumber = String(input.idNumber || '').replace(/[^\dA-Za-z-]/g, '');
    if (idNumber.length < 3) throw new BadRequestException('Escribe el número de documento del tercero.');
    if (!String(input.name || '').trim()) throw new BadRequestException('Escribe el nombre del tercero.');
    const existing = await this.thirdParties.findOne({ where: { companyId: c.id, idNumber } });
    return this.thirdParties.save(Object.assign(existing || this.thirdParties.create({ companyId: c.id, idNumber }), {
      idType: input.idType || existing?.idType || '13', name: input.name.trim().slice(0, 200), email: input.email?.trim() || existing?.email || null,
    }));
  }

  // ═══════════════════════ Comprobantes

  async createVoucher(input: VoucherInput, user: string): Promise<AccVoucher> {
    const c = await this.company();
    if (!['CI', 'CE', 'NC'].includes(input.type)) throw new BadRequestException('Tipo de comprobante no válido.');
    if (!isDate(input.date)) throw new BadRequestException('Fecha no válida.');
    if (!String(input.description || '').trim()) throw new BadRequestException('Escribe la descripción del comprobante.');
    await this.assertValid(c.id, input.lines);
    if (input.post) await this.assertOpen(c.id, input.date);
    return this.insertVoucher(c.id, { type: input.type, date: input.date, description: input.description, lines: input.lines, status: input.post ? 'CONTABILIZADO' : 'BORRADOR' }, user);
  }

  /**
   * Comprobante contabilizado con clave de origen (una factura recibida, por
   * ejemplo): si ya existe uno con esa clave, no se crea otro.
   */
  async postSourced(input: VoucherInput & { sourceKey: string }, user: string): Promise<AccVoucher> {
    const c = await this.company();
    const existing = await this.vouchers.findOne({ where: { companyId: c.id, sourceKey: input.sourceKey } });
    if (existing) throw new BadRequestException('Ese documento ya está contabilizado.');
    if (!isDate(input.date)) throw new BadRequestException('Fecha no válida.');
    await this.assertValid(c.id, input.lines);
    await this.assertOpen(c.id, input.date);
    return this.insertVoucher(c.id, { type: input.type, date: input.date, description: input.description, lines: input.lines, status: 'CONTABILIZADO', sourceKey: input.sourceKey }, user);
  }

  async updateDraft(id: string, input: VoucherInput) {
    const c = await this.company();
    const v = await this.vouchers.findOne({ where: { id, companyId: c.id }, relations: ['lines'] });
    if (!v) throw new NotFoundException('Comprobante no encontrado.');
    if (v.status !== 'BORRADOR') throw new BadRequestException('Solo se editan los borradores: un comprobante contabilizado se corrige reversándolo.');
    if (!isDate(input.date)) throw new BadRequestException('Fecha no válida.');
    await this.assertValid(c.id, input.lines);
    await this.lines.delete({ voucherId: v.id });
    Object.assign(v, { date: input.date, description: input.description.trim().slice(0, 300), total: totals(input.lines).debit, lines: this.lineEntities(c.id, input.lines) });
    return this.vouchers.save(v);
  }

  async post(id: string) {
    const c = await this.company();
    const v = await this.vouchers.findOne({ where: { id, companyId: c.id }, relations: ['lines'] });
    if (!v) throw new NotFoundException('Comprobante no encontrado.');
    if (v.status !== 'BORRADOR') throw new BadRequestException('El comprobante ya está contabilizado.');
    await this.assertValid(c.id, v.lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })));
    await this.assertOpen(c.id, v.date);
    v.status = 'CONTABILIZADO';
    v.postedAt = new Date();
    return this.vouchers.save(v);
  }

  async deleteDraft(id: string) {
    const c = await this.company();
    const v = await this.vouchers.findOne({ where: { id, companyId: c.id } });
    if (!v) throw new NotFoundException('Comprobante no encontrado.');
    if (v.status !== 'BORRADOR') throw new BadRequestException('Solo se eliminan los borradores; lo contabilizado se reversa.');
    await this.vouchers.delete(v.id);
    return { ok: true };
  }

  /** Reversa un comprobante contabilizado con una nota contable opuesta (lo emitido no se borra). */
  async reverse(id: string, reason: string, user: string) {
    const c = await this.company();
    const v = await this.vouchers.findOne({ where: { id, companyId: c.id }, relations: ['lines'] });
    if (!v) throw new NotFoundException('Comprobante no encontrado.');
    if (v.status !== 'CONTABILIZADO') throw new BadRequestException('Solo se reversan los comprobantes contabilizados.');
    if (!String(reason || '').trim()) throw new BadRequestException('Escribe el motivo de la reversión.');
    const date = today();
    await this.assertOpen(c.id, date);
    const rev = await this.insertVoucher(c.id, {
      type: 'NC', date, status: 'CONTABILIZADO', reversalOfId: v.id,
      description: `Reversa de ${v.type}-${v.number}: ${reason.trim()}`.slice(0, 300),
      lines: v.lines.map((l) => ({ accountCode: l.accountCode, thirdPartyId: l.thirdPartyId, description: l.description, debit: Number(l.credit), credit: Number(l.debit) })),
    }, user);
    v.status = 'ANULADO';
    v.reversalOfId = rev.id;
    await this.vouchers.save(v);
    return rev;
  }

  async listVouchers(f: { from?: string; to?: string; type?: string; status?: string; q?: string }) {
    const c = await this.company();
    const qb = this.vouchers.createQueryBuilder('v').where('v.companyId = :c', { c: c.id });
    if (isDate(f.from)) qb.andWhere('v.date >= :from', { from: f.from });
    if (isDate(f.to)) qb.andWhere('v.date <= :to', { to: f.to });
    if (f.type) qb.andWhere('v.type = :type', { type: f.type });
    if (f.status) qb.andWhere('v.status = :status', { status: f.status });
    if (f.q) qb.andWhere('v.description ILIKE :q', { q: `%${f.q}%` });
    return qb.orderBy('v.date', 'DESC').addOrderBy('v.number', 'DESC').take(500).getMany();
  }

  async getVoucher(id: string) {
    const c = await this.company();
    const v = await this.vouchers.findOne({ where: { id, companyId: c.id }, relations: ['lines'] });
    if (!v) throw new NotFoundException('Comprobante no encontrado.');
    return v;
  }

  // ═══════════════════════ Periodos

  async listPeriods() {
    const c = await this.company();
    return this.periods.find({ where: { companyId: c.id }, order: { month: 'DESC' } });
  }

  async setPeriod(month: string, status: 'ABIERTO' | 'CERRADO', user: string) {
    const c = await this.company();
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('Mes no válido (YYYY-MM).');
    if (status === 'CERRADO') {
      const drafts = await this.vouchers.count({ where: { companyId: c.id, status: 'BORRADOR', date: Between(`${month}-01`, `${month}-31`) } });
      if (drafts) throw new BadRequestException(`Hay ${drafts} borrador(es) en ${month}: contabilízalos o elimínalos antes de cerrar.`);
    }
    const p = (await this.periods.findOne({ where: { companyId: c.id, month } })) || this.periods.create({ companyId: c.id, month });
    Object.assign(p, { status, closedBy: status === 'CERRADO' ? user : null, closedAt: status === 'CERRADO' ? new Date() : null });
    return this.periods.save(p);
  }

  // ═══════════════════════ Reportes

  async trialBalance(from: string, to: string) {
    const c = await this.company();
    this.assertRange(from, to);
    const [movs, accs] = await Promise.all([this.movements(c.id, to), this.accounts.find({ where: { companyId: c.id } })]);
    const rows = trialBalance(movs, accs, from, to);
    return { company: c.name, from, to, rows, totals: { debit: r2(rows.filter((r) => r.level === 1).reduce((s, r) => s + r.debit, 0)), credit: r2(rows.filter((r) => r.level === 1).reduce((s, r) => s + r.credit, 0)) } };
  }

  async incomeStatement(from: string, to: string) {
    const tb = await this.trialBalance(from, to);
    return { company: tb.company, from, to, ...incomeStatement(tb.rows) };
  }

  async balanceSheet(to: string) {
    const c = await this.company();
    if (!isDate(to)) throw new BadRequestException('Fecha no válida.');
    const yearStart = `${to.slice(0, 4)}-01-01`;
    const [movs, accs] = await Promise.all([this.movements(c.id, to), this.accounts.find({ where: { companyId: c.id } })]);
    const rows = trialBalance(movs, accs, yearStart, to);
    const ejercicio = resultOf(movs.filter((m) => m.date >= yearStart));
    const anteriores = resultOf(movs.filter((m) => m.date < yearStart));
    return { company: c.name, to, ...balanceSheet(rows, ejercicio, anteriores) };
  }

  /** Libro mayor / auxiliar de una cuenta: saldo inicial y cada movimiento con su saldo. */
  async ledger(accountCode: string, from: string, to: string) {
    const c = await this.company();
    this.assertRange(from, to);
    const acc = await this.accounts.findOne({ where: { companyId: c.id, code: accountCode } });
    if (!acc) throw new NotFoundException('Cuenta no encontrada.');
    const rows: any[] = await this.dataSource.query(
      `SELECT v.id AS "voucherId", v.type, v.number, v.date::text AS date, v.description AS voucher, l.description, l.debit, l.credit,
              t.name AS "thirdParty", t."idNumber" AS "thirdPartyId"
         FROM acc_voucher_lines l
         JOIN acc_vouchers v ON v.id = l."voucherId" AND v.status <> 'BORRADOR'
         LEFT JOIN acc_third_parties t ON t.id = l."thirdPartyId"
        WHERE l."companyId" = $1 AND l."accountCode" LIKE $2 AND v.date <= $3
        ORDER BY v.date, v.type, v.number`,
      [c.id, `${accountCode}%`, to],
    );
    const sign = acc.nature === 'DEBITO' ? 1 : -1;
    const pnl = ['4', '5', '6', '7'].includes(accountCode[0]);
    const yearStart = `${from.slice(0, 4)}-01-01`;
    let balance = 0;
    const out: any[] = [];
    for (const r of rows) {
      const d = Number(r.debit), cr = Number(r.credit);
      if (r.date < from) { if (!(pnl && r.date < yearStart)) balance = r2(balance + sign * (d - cr)); continue; }
      if (!out.length) out.push({ opening: balance });
      balance = r2(balance + sign * (d - cr));
      out.push({ ...r, debit: d, credit: cr, balance });
    }
    const movements = out.filter((x) => !('opening' in x));
    return { account: acc, from, to, opening: out[0]?.opening ?? balance, movements, closing: balance };
  }

  // ═══════════════════════ Asientos automáticos desde Authoriza

  /**
   * Contabiliza las facturas y pagos de CycloNet que aún no tienen asiento
   * (idempotente por sourceKey). Los meses cerrados se omiten y se informan.
   */
  async syncAuthoriza(user = 'sistema') {
    const c = await this.company();
    const res = await fetch(`${this.authorizaUrl}/api/invoices`, { headers: authorizaInternalHeaders(), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new BadRequestException(`Authoriza no respondió (HTTP ${res.status}).`);
    const invoices: any[] = await res.json();
    const map = { ...DEFAULT_ACCOUNT_MAP, ...(c.accountMap || {}) } as any;
    const done = new Set((await this.vouchers.find({ where: { companyId: c.id, type: 'AUT' }, select: ['sourceKey'] })).map((v) => v.sourceKey));
    const closed = new Set((await this.periods.find({ where: { companyId: c.id, status: 'CERRADO' } })).map((p) => p.month));
    let created = 0;
    const skipped: string[] = [];
    for (const inv of invoices) {
      for (const draft of vouchersFromInvoice(inv, map)) {
        if (done.has(draft.sourceKey)) continue;
        if (c.autoFrom && draft.date < c.autoFrom) continue;
        if (closed.has(draft.date.slice(0, 7))) { skipped.push(`${draft.description} (${draft.date}: mes cerrado)`); continue; }
        const thirdPartyId = draft.clientUserId ? (await this.clientThirdParty(c.id, inv)).id : null;
        await this.insertVoucher(c.id, {
          type: 'AUT', date: draft.date, description: draft.description, status: 'CONTABILIZADO', sourceKey: draft.sourceKey,
          lines: draft.lines.map(({ client, ...l }) => ({ ...l, thirdPartyId: client ? thirdPartyId : null })),
        }, user);
        done.add(draft.sourceKey);
        created++;
      }
    }
    if (created) this.logger.log(`Contabilidad: ${created} asiento(s) automático(s) desde Authoriza`);
    return { invoices: invoices.length, created, skipped };
  }

  /** Tercero del cliente de una factura (por su usuario de Authoriza). */
  private async clientThirdParty(companyId: string, inv: any): Promise<AccThirdParty> {
    const userId = String(inv.user?.id || inv.userId);
    const found = await this.thirdParties.findOne({ where: { companyId, authorizaUserId: userId } });
    if (found) return found;
    const bd = inv.user?.basicData;
    const name = bd?.legalEntityData?.businessName
      || [bd?.naturalPersonData?.firstName, bd?.naturalPersonData?.firstSurname].filter(Boolean).join(' ')
      || inv.user?.strUserName || `Cliente ${userId.slice(0, 8)}`;
    const docType = String(bd?.documentType?.documentType || '').toUpperCase();
    const idNumber = String(bd?.documentNumber || '').replace(/\D/g, '') || `AUT-${userId.slice(0, 20)}`;
    const existing = await this.thirdParties.findOne({ where: { companyId, idNumber } });
    if (existing) { existing.authorizaUserId = userId; return this.thirdParties.save(existing); }
    return this.thirdParties.save(this.thirdParties.create({
      companyId, idType: docType === 'NIT' ? '31' : '13', idNumber, name: String(name).slice(0, 200), email: inv.user?.strUserName || null, authorizaUserId: userId,
    }));
  }

  // ═══════════════════════ Internos

  private async assertValid(companyId: string, lines: LineInput[]) {
    const accs = await this.accounts.find({ where: { companyId, code: In((lines || []).map((l) => String(l.accountCode || ''))) } });
    const errors = validateVoucher(lines, new Map(accs.map((a) => [a.code, a])));
    if (errors.length) throw new BadRequestException({ error: 'VOUCHER_INVALID', message: errors[0], errors });
  }

  private async assertOpen(companyId: string, date: string) {
    const p = await this.periods.findOne({ where: { companyId, month: date.slice(0, 7) } });
    if (p?.status === 'CERRADO') throw new BadRequestException(`El mes ${p.month} está cerrado: reábrelo para registrar en esa fecha.`);
  }

  private assertRange(from: string, to: string) {
    if (!isDate(from) || !isDate(to) || from > to) throw new BadRequestException('Revisa el rango de fechas.');
  }

  private lineEntities(companyId: string, lines: LineInput[]) {
    return lines.map((l) => this.lines.create({
      companyId, accountCode: l.accountCode, thirdPartyId: l.thirdPartyId || null, description: l.description?.slice(0, 300) || null,
      debit: r2(l.debit || 0), credit: r2(l.credit || 0),
    }));
  }

  /** Inserta con el consecutivo siguiente del tipo (con bloqueo para no repetir números). */
  private async insertVoucher(companyId: string, v: NewVoucher, user: string): Promise<AccVoucher> {
    return this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`acc:${companyId}:${v.type}`]);
      const [{ n }] = await m.query(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM acc_vouchers WHERE "companyId" = $1 AND type = $2`, [companyId, v.type]);
      const entity = m.create(AccVoucher, {
        companyId, type: v.type, number: Number(n), date: v.date, description: String(v.description).trim().slice(0, 300),
        status: v.status || 'BORRADOR', sourceKey: v.sourceKey || null, reversalOfId: v.reversalOfId || null,
        total: totals(v.lines).debit, createdBy: user, postedAt: v.status === 'CONTABILIZADO' ? new Date() : null,
        lines: this.lineEntities(companyId, v.lines),
      });
      return m.save(entity);
    });
  }

  /** Movimientos contabilizados (y anulados con su reversa, que se compensan) hasta una fecha. */
  private async movements(companyId: string, to: string): Promise<Movement[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT l."accountCode", l.debit, l.credit, v.date::text AS date
         FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l."voucherId"
        WHERE l."companyId" = $1 AND v.status <> 'BORRADOR' AND v.date <= $2`,
      [companyId, to],
    );
    return rows.map((r) => ({ accountCode: r.accountCode, debit: Number(r.debit), credit: Number(r.credit), date: String(r.date).slice(0, 10) }));
  }
}
