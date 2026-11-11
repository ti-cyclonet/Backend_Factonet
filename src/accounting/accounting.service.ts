import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, ILike, In, Repository } from 'typeorm';
import { AccAccount, AccCompany, AccPeriod, AccThirdParty, AccVoucher, AccVoucherLine } from './entities';
import { AccountMap, DEFAULT_ACCOUNT_MAP, PUC_BASE, levelOf, natureOf, parentOf } from './puc';
import { LineInput, Movement, balanceSheet, incomeStatement, resultOf, totals, trialBalance, validateVoucher, vouchersFromInvoice } from './ledger';
import { authorizaInternalHeaders } from '../common/authoriza-internal';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
/** Alias del buzón de facturas de CycloNet (cyclonet@<INBOX_DOMAIN>). */
const cyclonetInboxAlias = () => (process.env.ACCOUNTING_CYCLONET_INBOX_ALIAS || 'cyclonet').trim().toLowerCase();

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

/**
 * Empresa de la sesión. Sin scope (procesos internos o el administrador de
 * FactoNet) se usa la empresa de CycloNet; con tenantId, la del cliente que
 * contrató FactoNet (empresaFactonet / contadorFactonet).
 */
export interface Scope {
  tenantId: string;
}

/** La empresa del cliente aún no tiene sus datos contables configurados. */
export class CompanySetupRequired extends ConflictException {
  constructor() {
    super({ code: 'EMPRESA_SIN_CONFIGURAR', message: 'Configura los datos de tu empresa para empezar tu contabilidad.' });
  }
}

/** Alias reservados del buzón de facturas. */
const RESERVED_ALIASES = new Set(['cyclonet', 'admin', 'administrador', 'facturas', 'postmaster', 'abuse', 'noreply', 'no-reply', 'soporte', 'support', 'info', 'contabilidad', 'factonet']);

/** "Tienda La Esquina S.A.S." → "tienda-la-esquina". */
export function aliasFromName(name: string): string {
  const base = String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(s\.?\s?a\.?\s?s|s\.?\s?a|ltda|e\.?\s?u|s\.?\s?c\.?\s?a)\.?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return base || 'empresa';
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

  /**
   * Empresa de la sesión: la del cliente (scope) o la de CycloNet (se crea con
   * el PUC base la primera vez). La del cliente se crea con setupCompany.
   */
  async company(scope?: Scope): Promise<AccCompany> {
    if (scope?.tenantId) {
      const own = await this.companies.findOne({ where: { tenantId: scope.tenantId } });
      if (!own) throw new CompanySetupRequired();
      if (!this.pucSynced.has(own.id)) {
        await this.addMissingPucAccounts(own.id);
        this.pucSynced.add(own.id);
      }
      return own;
    }
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
        inboxAlias: cyclonetInboxAlias(),
      }));
      await this.seedPuc(c.id);
      this.pucSynced.add(c.id);
      this.logger.log(`Empresa contable creada: ${c.name} (PUC base cargado)`);
    }
    if (!c.inboxAlias) {
      c.inboxAlias = cyclonetInboxAlias();
      await this.companies.update({ id: c.id }, { inboxAlias: c.inboxAlias });
    }
    if (!this.pucSynced.has(c.id)) {
      await this.addMissingPucAccounts(c.id);
      this.pucSynced.add(c.id);
    }
    return c;
  }

  /** ¿La empresa del cliente ya está configurada? */
  async hasCompany(scope: Scope): Promise<boolean> {
    return !!(await this.companies.findOne({ where: { tenantId: scope.tenantId }, select: ['id'] }));
  }

  /**
   * Primera configuración de la empresa de un cliente: razón social, NIT y si
   * es responsable de IVA (el IVA de sus compras es descontable o va al gasto).
   * Carga el PUC base y le asigna su buzón de facturas.
   */
  async setupCompany(scope: Scope, input: { name: string; nit: string; ivaResponsable?: boolean }): Promise<AccCompany> {
    if (await this.hasCompany(scope)) throw new BadRequestException('La empresa ya está configurada.');
    const name = String(input?.name || '').trim();
    const nit = String(input?.nit || '').trim();
    if (name.length < 3) throw new BadRequestException('Escribe la razón social de la empresa.');
    if (!/^\d[\d.\s]{4,14}(-\s?\d)?$/.test(nit)) throw new BadRequestException('Escribe el NIT o documento de la empresa (por ejemplo 900123456-7).');
    const c = await this.companies.save(this.companies.create({
      tenantId: scope.tenantId,
      name: name.slice(0, 200),
      nit: nit.replace(/\s/g, '').slice(0, 20),
      accountMap: { ...DEFAULT_ACCOUNT_MAP, ivaCompras: input.ivaResponsable === false ? 'gasto' : '240810' },
      autoFrom: null,
      inboxAlias: await this.uniqueAlias(aliasFromName(name)),
    }));
    await this.seedPuc(c.id);
    this.pucSynced.add(c.id);
    this.logger.log(`Empresa contable creada: ${c.name} (${c.inboxAlias})`);
    return c;
  }

  /** Cambia los datos de la empresa del cliente (no el alias del buzón). */
  async updateCompany(scope: Scope | undefined, input: { name?: string; nit?: string; ivaResponsable?: boolean }): Promise<AccCompany> {
    const c = await this.company(scope);
    if (input.name !== undefined) {
      if (String(input.name).trim().length < 3) throw new BadRequestException('Escribe la razón social de la empresa.');
      c.name = String(input.name).trim().slice(0, 200);
    }
    if (input.nit !== undefined) c.nit = String(input.nit).replace(/\s/g, '').slice(0, 20) || null;
    if (input.ivaResponsable !== undefined) c.accountMap = { ...(c.accountMap || {}), ivaCompras: input.ivaResponsable ? '240810' : 'gasto' };
    return this.companies.save(c);
  }

  private async uniqueAlias(base: string): Promise<string> {
    for (let i = 1; i < 1000; i++) {
      const alias = i === 1 ? base : `${base.slice(0, 27)}-${i}`;
      if (RESERVED_ALIASES.has(alias)) continue;
      if (!(await this.companies.findOne({ where: { inboxAlias: alias }, select: ['id'] }))) return alias;
    }
    throw new BadRequestException('No se pudo asignar el buzón de facturas.');
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

  async listAccounts(scope?: Scope) {
    const c = await this.company(scope);
    return this.accounts.find({ where: { companyId: c.id }, order: { code: 'ASC' } });
  }

  /** Nueva subcuenta (6 dígitos) o auxiliar (8+) bajo una cuenta existente. */
  async createAccount(input: { code: string; name: string; requiresThirdParty?: boolean }, scope?: Scope) {
    const c = await this.company(scope);
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

  async listThirdParties(q?: string, scope?: Scope) {
    const c = await this.company(scope);
    const where = q ? [{ companyId: c.id, name: ILike(`%${q}%`) }, { companyId: c.id, idNumber: ILike(`%${q}%`) }] : { companyId: c.id };
    return this.thirdParties.find({ where: where as any, order: { name: 'ASC' }, take: 200 });
  }

  async saveThirdParty(input: { idType?: string; idNumber: string; name: string; email?: string }, scope?: Scope) {
    const c = await this.company(scope);
    return this.saveThirdPartyFor(c.id, input);
  }

  /** Crea o actualiza un tercero de una empresa dada (p. ej. el proveedor de una factura recibida). */
  async saveThirdPartyFor(companyId: string, input: { idType?: string; idNumber: string; name: string; email?: string }) {
    const c = { id: companyId };
    const idNumber = String(input.idNumber || '').replace(/[^\dA-Za-z-]/g, '');
    if (idNumber.length < 3) throw new BadRequestException('Escribe el número de documento del tercero.');
    if (!String(input.name || '').trim()) throw new BadRequestException('Escribe el nombre del tercero.');
    const existing = await this.thirdParties.findOne({ where: { companyId: c.id, idNumber } });
    return this.thirdParties.save(Object.assign(existing || this.thirdParties.create({ companyId: c.id, idNumber }), {
      idType: input.idType || existing?.idType || '13', name: input.name.trim().slice(0, 200), email: input.email?.trim() || existing?.email || null,
    }));
  }

  // ═══════════════════════ Comprobantes

  async createVoucher(input: VoucherInput, user: string, scope?: Scope): Promise<AccVoucher> {
    const c = await this.company(scope);
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
  async postSourced(input: VoucherInput & { sourceKey: string }, user: string, scope?: Scope): Promise<AccVoucher> {
    const c = await this.company(scope);
    const existing = await this.vouchers.findOne({ where: { companyId: c.id, sourceKey: input.sourceKey } });
    if (existing) throw new BadRequestException('Ese documento ya está contabilizado.');
    if (!isDate(input.date)) throw new BadRequestException('Fecha no válida.');
    await this.assertValid(c.id, input.lines);
    await this.assertOpen(c.id, input.date);
    return this.insertVoucher(c.id, { type: input.type, date: input.date, description: input.description, lines: input.lines, status: 'CONTABILIZADO', sourceKey: input.sourceKey }, user);
  }

  async updateDraft(id: string, input: VoucherInput, scope?: Scope) {
    const c = await this.company(scope);
    const v = await this.vouchers.findOne({ where: { id, companyId: c.id }, relations: ['lines'] });
    if (!v) throw new NotFoundException('Comprobante no encontrado.');
    if (v.status !== 'BORRADOR') throw new BadRequestException('Solo se editan los borradores: un comprobante contabilizado se corrige reversándolo.');
    if (!isDate(input.date)) throw new BadRequestException('Fecha no válida.');
    await this.assertValid(c.id, input.lines);
    await this.lines.delete({ voucherId: v.id });
    Object.assign(v, { date: input.date, description: input.description.trim().slice(0, 300), total: totals(input.lines).debit, lines: this.lineEntities(c.id, input.lines) });
    return this.vouchers.save(v);
  }

  async post(id: string, scope?: Scope) {
    const c = await this.company(scope);
    const v = await this.vouchers.findOne({ where: { id, companyId: c.id }, relations: ['lines'] });
    if (!v) throw new NotFoundException('Comprobante no encontrado.');
    if (v.status !== 'BORRADOR') throw new BadRequestException('El comprobante ya está contabilizado.');
    await this.assertValid(c.id, v.lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })));
    await this.assertOpen(c.id, v.date);
    v.status = 'CONTABILIZADO';
    v.postedAt = new Date();
    return this.vouchers.save(v);
  }

  async deleteDraft(id: string, scope?: Scope) {
    const c = await this.company(scope);
    const v = await this.vouchers.findOne({ where: { id, companyId: c.id } });
    if (!v) throw new NotFoundException('Comprobante no encontrado.');
    if (v.status !== 'BORRADOR') throw new BadRequestException('Solo se eliminan los borradores; lo contabilizado se reversa.');
    await this.vouchers.delete(v.id);
    return { ok: true };
  }

  /** Reversa un comprobante contabilizado con una nota contable opuesta (lo emitido no se borra). */
  async reverse(id: string, reason: string, user: string, scope?: Scope) {
    const c = await this.company(scope);
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

  async listVouchers(f: { from?: string; to?: string; type?: string; status?: string; q?: string }, scope?: Scope) {
    const c = await this.company(scope);
    const qb = this.vouchers.createQueryBuilder('v').where('v.companyId = :c', { c: c.id });
    if (isDate(f.from)) qb.andWhere('v.date >= :from', { from: f.from });
    if (isDate(f.to)) qb.andWhere('v.date <= :to', { to: f.to });
    if (f.type) qb.andWhere('v.type = :type', { type: f.type });
    if (f.status) qb.andWhere('v.status = :status', { status: f.status });
    if (f.q) qb.andWhere('v.description ILIKE :q', { q: `%${f.q}%` });
    return qb.orderBy('v.date', 'DESC').addOrderBy('v.number', 'DESC').take(500).getMany();
  }

  async getVoucher(id: string, scope?: Scope) {
    const c = await this.company(scope);
    const v = await this.vouchers.findOne({ where: { id, companyId: c.id }, relations: ['lines'] });
    if (!v) throw new NotFoundException('Comprobante no encontrado.');
    return v;
  }

  // ═══════════════════════ Periodos

  async listPeriods(scope?: Scope) {
    const c = await this.company(scope);
    return this.periods.find({ where: { companyId: c.id }, order: { month: 'DESC' } });
  }

  async setPeriod(month: string, status: 'ABIERTO' | 'CERRADO', user: string, scope?: Scope) {
    const c = await this.company(scope);
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

  async trialBalance(from: string, to: string, scope?: Scope) {
    const c = await this.company(scope);
    this.assertRange(from, to);
    const [movs, accs] = await Promise.all([this.movements(c.id, to), this.accounts.find({ where: { companyId: c.id } })]);
    const rows = trialBalance(movs, accs, from, to);
    return { company: c.name, from, to, rows, totals: { debit: r2(rows.filter((r) => r.level === 1).reduce((s, r) => s + r.debit, 0)), credit: r2(rows.filter((r) => r.level === 1).reduce((s, r) => s + r.credit, 0)) } };
  }

  async incomeStatement(from: string, to: string, scope?: Scope) {
    const tb = await this.trialBalance(from, to, scope);
    return { company: tb.company, from, to, ...incomeStatement(tb.rows) };
  }

  async balanceSheet(to: string, scope?: Scope) {
    const c = await this.company(scope);
    if (!isDate(to)) throw new BadRequestException('Fecha no válida.');
    const yearStart = `${to.slice(0, 4)}-01-01`;
    const [movs, accs] = await Promise.all([this.movements(c.id, to), this.accounts.find({ where: { companyId: c.id } })]);
    const rows = trialBalance(movs, accs, yearStart, to);
    const ejercicio = resultOf(movs.filter((m) => m.date >= yearStart));
    const anteriores = resultOf(movs.filter((m) => m.date < yearStart));
    return { company: c.name, to, ...balanceSheet(rows, ejercicio, anteriores) };
  }

  /** Libro mayor / auxiliar de una cuenta: saldo inicial y cada movimiento con su saldo. */
  async ledger(accountCode: string, from: string, to: string, scope?: Scope) {
    const c = await this.company(scope);
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
