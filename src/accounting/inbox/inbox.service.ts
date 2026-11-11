import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { simpleParser } from 'mailparser';
import { AccCompany, AccInboxDocument, AccSupplierRule, AccThirdParty } from '../entities';
import { AccountingService } from '../accounting.service';
import { AccountMap } from '../puc';
import { LineInput } from '../ledger';
import { ExtractedFile, SupplierDocument, extractDocuments, nitBase, parseSupplierDocument } from './ubl';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export interface IngestMeta { source: 'CORREO' | 'CARGA'; from?: string | null; subject?: string | null }
export interface IngestResult { id: string; status: AccInboxDocument['status']; number: string | null; supplierName: string | null; message: string | null }

/** Lo mínimo de un documento recibido para armar su asiento. */
export interface InboxDocLike {
  kind: 'Invoice' | 'CreditNote' | null;
  number: string | null;
  supplierName: string | null;
  base: number | string;
  iva: number | string;
  otherTaxes: number | string;
  payable: number | string;
  data: { withholdings?: { renta: number; iva: number; ica: number } } | null;
}

/**
 * Asiento de una factura de proveedor (causación):
 *   gasto (base + otros tributos [+ IVA si no es descontable]) / IVA descontable
 *   contra retenciones practicadas y la cuenta por pagar al proveedor.
 * Una nota crédito del proveedor genera el asiento contrario.
 */
export function inboxVoucherLines(doc: InboxDocLike, map: Required<AccountMap>, expenseAccount: string, supplierId: string | null): { lines: LineInput[]; total: number; warning: string | null } {
  const base = r2(Number(doc.base));
  const iva = r2(Number(doc.iva));
  const other = r2(Number(doc.otherTaxes));
  const ivaToExpense = !map.ivaCompras || map.ivaCompras === 'gasto';
  const w = doc.data?.withholdings || { renta: 0, iva: 0, ica: 0 };
  const label = `${doc.kind === 'CreditNote' ? 'NC' : 'Factura'} ${doc.number || ''} · ${doc.supplierName || 'proveedor'}`.trim();

  const debits: LineInput[] = [];
  const expense = r2(base + other + (ivaToExpense ? iva : 0));
  if (expense) debits.push({ accountCode: expenseAccount, debit: expense, credit: 0, description: ivaToExpense && iva ? `${label} (incluye IVA no descontable)` : label });
  if (!ivaToExpense && iva) debits.push({ accountCode: map.ivaCompras, debit: iva, credit: 0, description: `IVA ${label}` });
  const debitTotal = r2(debits.reduce((s, l) => s + l.debit, 0));

  const credits: LineInput[] = [];
  const add = (acc: string, v: number, what: string) => { if (r2(v) > 0) credits.push({ accountCode: acc, debit: 0, credit: r2(v), thirdPartyId: supplierId, description: `${what} ${label}` }); };
  add(map.retencionRenta, w.renta, 'Retención en la fuente');
  add(map.retencionIva, w.iva, 'ReteIVA');
  add(map.retencionIca, w.ica, 'ReteICA');
  const withheld = r2(credits.reduce((s, l) => s + l.credit, 0));
  if (debitTotal - withheld <= 0) throw new BadRequestException('El documento no tiene valores para contabilizar.');
  credits.push({ accountCode: map.proveedores, debit: 0, credit: r2(debitTotal - withheld), thirdPartyId: supplierId, description: label });

  const payable = r2(Number(doc.payable));
  const warning = payable && Math.abs(payable - debitTotal) > 1
    ? `El total calculado ($${debitTotal.toLocaleString('es-CO')}) no coincide con el valor a pagar de la factura ($${payable.toLocaleString('es-CO')}). Revisa anticipos o cargos antes de aprobar.`
    : null;

  let lines = [...debits, ...credits];
  if (doc.kind === 'CreditNote') lines = lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
  return { lines, total: debitTotal, warning };
}

/**
 * Bandeja de facturas recibidas de proveedores (fase 1: CycloNet).
 * Nada se contabiliza sin aprobación: cada documento queda PENDIENTE con la
 * cuenta sugerida por la regla del proveedor, y al aprobarlo se crea su
 * comprobante contabilizado.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @InjectRepository(AccInboxDocument) private readonly docs: Repository<AccInboxDocument>,
    @InjectRepository(AccSupplierRule) private readonly rules: Repository<AccSupplierRule>,
    @InjectRepository(AccThirdParty) private readonly thirdParties: Repository<AccThirdParty>,
    @InjectRepository(AccCompany) private readonly companies: Repository<AccCompany>,
    private readonly acc: AccountingService,
  ) {}

  /** Subdominio de los buzones (SES): cada empresa recibe en <alias>@<dominio>. */
  domain(): string | null {
    return (process.env.INBOX_DOMAIN || '').trim().toLowerCase() || null;
  }

  /** Dirección que la empresa les da a sus proveedores. */
  addressOf(c: { inboxAlias: string | null }): string | null {
    const domain = this.domain();
    if (domain && c.inboxAlias) return `${c.inboxAlias}@${domain}`;
    return (process.env.INBOX_ADDRESS || '').trim() || null;
  }

  /** Empresa por defecto (CycloNet). */
  defaultCompany(): Promise<AccCompany> {
    return this.acc.company();
  }

  /** Dirección de CycloNet (la pantalla de hoy es la de CycloNet). */
  async address(): Promise<string | null> {
    return this.addressOf(await this.acc.company());
  }

  // ═══════════════════════ Entrada

  /**
   * Un correo completo (MIME), tal como lo guarda SES en S3 o se lee por IMAP.
   * La empresa se identifica por la dirección que lo recibió (<alias>@dominio);
   * si no se puede (p. ej. un reenvío que conserva el destinatario original),
   * por el NIT del comprador en cada factura.
   */
  async ingestRawEmail(raw: Buffer, fallback: AccCompany | null = null): Promise<IngestResult[]> {
    await this.acc.company(); // asegura la empresa de CycloNet (y su alias) antes de buscar destinatarios
    const mail = await simpleParser(raw);
    const from = mail.from?.text || null;
    const subject = mail.subject || null;
    const company = (await this.companyByRecipient(raw, mail)) || fallback;

    // Gmail pide confirmar el reenvío automático: se muestra el código al cliente.
    if (/forwarding-noreply@google\.com/i.test(from || '')) {
      if (!company) return [];
      const text = `${mail.text || ''}`;
      const code = text.match(/(?:c[oó]digo de confirmaci[oó]n|confirmation code)\D{0,20}(\d{6,12})/i)?.[1];
      const link = text.match(/https:\/\/(?:mail-settings\.google\.com|mail\.google\.com)\/\S+/i)?.[0];
      const message = ['Gmail pide confirmar el reenvío automático hacia este buzón.', code ? `Código de confirmación: ${code}.` : '', link ? `O abre este enlace: ${link}` : ''].filter(Boolean).join(' ');
      return [await this.saveDoc({ companyId: company.id, source: 'CORREO', fromAddress: from?.slice(0, 255) || null, subject: subject?.slice(0, 300) || null, status: 'AVISO', message })];
    }

    const files: ExtractedFile[] = (mail.attachments || []).map((a) => ({ name: a.filename || 'adjunto', data: a.content }));
    return this.ingestFiles(files, { source: 'CORREO', from, subject }, company);
  }

  /** Empresa dueña del alias al que llegó el correo (Received "for", Delivered-To, To, Cc…). */
  private async companyByRecipient(raw: Buffer, mail: Awaited<ReturnType<typeof simpleParser>>): Promise<AccCompany | null> {
    const domain = this.domain();
    if (!domain) return null;
    const head = raw.subarray(0, 64 * 1024).toString('utf8').split(/\r?\n\r?\n/)[0];
    const found = new Set<string>();
    const re = new RegExp(`([a-z0-9._%+-]+)@${domain.replace(/\./g, '\\.')}`, 'gi');
    for (const m of head.matchAll(re)) found.add(m[1].toLowerCase());
    const listed = [mail.to, mail.cc].flatMap((x: any) => (Array.isArray(x) ? x : x ? [x] : [])).flatMap((x: any) => x.value || []);
    for (const a of listed) {
      const [local, host] = String(a.address || '').toLowerCase().split('@');
      if (host === domain && local) found.add(local);
    }
    for (const alias of found) {
      const c = await this.companies.findOne({ where: { inboxAlias: alias } });
      if (c) return c;
    }
    return null;
  }

  /** Empresa cuyo NIT coincide con el del comprador de la factura. */
  private async companyByNit(nit: string): Promise<AccCompany | null> {
    const base = nitBase(nit);
    if (!base) return null;
    const all = await this.companies.find({ select: ['id', 'nit', 'name', 'inboxAlias', 'tenantId', 'accountMap', 'autoFrom', 'createdAt'] });
    const matches = all.filter((c) => nitBase(c.nit) === base);
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * Adjuntos de un correo o archivos subidos a mano (ZIP, XML o PDF).
   * `company`: la empresa destino si se conoce (carga a mano, alias del buzón).
   * Los correos sin facturas se ignoran en silencio.
   */
  async ingestFiles(files: ExtractedFile[], meta: IngestMeta, company: AccCompany | null = null): Promise<IngestResult[]> {
    if (meta.source === 'CARGA' && !company) company = await this.acc.company();
    const base = { source: meta.source, fromAddress: meta.from?.slice(0, 255) || null, subject: meta.subject?.slice(0, 300) || null };
    let extracted: { xmls: ExtractedFile[]; pdfs: ExtractedFile[] };
    try {
      extracted = await extractDocuments(files);
    } catch (e: any) {
      if (!company) return [];
      return [await this.saveDoc({ ...base, companyId: company.id, status: 'ERROR', message: `No se pudieron abrir los adjuntos: ${e.message}` })];
    }
    const { xmls, pdfs } = extracted;

    const parsed: { doc: SupplierDocument; xml: string }[] = [];
    const errors: string[] = [];
    for (const f of xmls) {
      const xml = f.data.toString('utf8');
      try {
        parsed.push({ doc: parseSupplierDocument(xml), xml });
      } catch (e: any) {
        errors.push(`${f.name}: ${e.message}`);
      }
    }

    const out: IngestResult[] = [];
    if (!parsed.length) {
      // Sin factura legible: solo se registra si se sabe de qué empresa es.
      if (!company) {
        if (xmls.length || pdfs.length) this.logger.warn(`Buzón: correo de ${meta.from || '?'} sin empresa identificable; se ignora.`);
        return out;
      }
      if (pdfs.length) {
        for (const p of pdfs) {
          out.push(await this.saveDoc({ ...base, companyId: company.id, status: 'SIN_XML', pdfName: p.name, pdf: p.data,
            message: 'Llegó solo el PDF, sin la factura electrónica (XML). Pídele el XML al proveedor o regístrala a mano en Comprobantes.' }));
        }
      } else if (meta.source === 'CARGA' && (errors.length || files.length)) {
        out.push(await this.saveDoc({ ...base, companyId: company.id, status: 'ERROR', message: errors.length ? errors.join(' · ') : 'Los archivos no traen facturas (ZIP, XML o PDF).' }));
      } else if (errors.length && xmls.some((f) => /<(Invoice|CreditNote|AttachedDocument)\b/.test(f.data.toString('utf8', 0, 4000)))) {
        out.push(await this.saveDoc({ ...base, companyId: company.id, status: 'ERROR', message: errors.join(' · ') }));
      }
      return out;
    }

    for (const [i, { doc, xml }] of parsed.entries()) {
      const target = company || (await this.companyByNit(doc.customer.nit));
      if (!target) {
        this.logger.warn(`Buzón: factura ${doc.number} para el NIT ${doc.customer.nit || '?'} sin empresa en FactoNet; se ignora.`);
        continue;
      }
      const pdf = this.pickPdf(pdfs, doc, parsed.length, i);
      out.push(await this.register(target, doc, xml, pdf, { ...base, companyId: target.id }));
    }
    return out;
  }

  /** PDF del mismo ZIP: si hay uno solo, ese; si no, el que lleve el número del documento. */
  private pickPdf(pdfs: ExtractedFile[], doc: SupplierDocument, docs: number, index: number): ExtractedFile | null {
    if (!pdfs.length) return null;
    if (pdfs.length === 1) return pdfs[0];
    const byNumber = pdfs.find((p) => p.name.toLowerCase().includes(doc.number.toLowerCase()));
    return byNumber || (pdfs.length === docs ? pdfs[index] : null);
  }

  private async register(c: { id: string; nit: string | null }, doc: SupplierDocument, xml: string, pdf: ExtractedFile | null, base: Partial<AccInboxDocument>): Promise<IngestResult> {
    const fields: Partial<AccInboxDocument> = {
      ...base, companyId: c.id, kind: doc.kind, cufe: doc.cufe, supplierNit: doc.supplier.nit || null, supplierName: doc.supplier.name || null,
      number: doc.number, issueDate: doc.issueDate || null, dueDate: doc.dueDate, base: doc.base, iva: doc.iva, otherTaxes: doc.otherTaxes,
      payable: doc.payable, xml, pdf: pdf?.data || null, pdfName: pdf?.name || null,
      data: { lines: doc.lines, withholdings: doc.withholdings, customer: doc.customer, supplier: doc.supplier, currency: doc.currency, references: doc.references },
    };

    // ¿Va dirigida a esta empresa?
    const ours = nitBase(c.nit);
    if (ours && doc.customer.nit && nitBase(doc.customer.nit) !== ours) {
      return this.saveDoc({ ...fields, status: 'RECHAZADA', message: `La factura es para el NIT ${doc.customer.nit} (${doc.customer.name || 'otra empresa'}), no para esta empresa.` });
    }
    if (doc.currency && doc.currency !== 'COP') {
      return this.saveDoc({ ...fields, status: 'ERROR', message: `La factura está en ${doc.currency}: por ahora solo se contabilizan facturas en pesos. Regístrala a mano.` });
    }

    // ¿Ya llegó? (por CUFE; si no trae CUFE, por NIT + número)
    const dup = doc.cufe
      ? await this.docs.findOne({ where: { companyId: c.id, cufe: doc.cufe, status: In(['PENDIENTE', 'CONTABILIZADA', 'DESCARTADA', 'RECHAZADA', 'ERROR']) } })
      : await this.docs.findOne({ where: { companyId: c.id, supplierNit: doc.supplier.nit, number: doc.number } });
    if (dup) {
      return this.saveDoc({ ...fields, status: 'DUPLICADA', duplicateOfId: dup.id, message: `Ya se había recibido (${dup.status.toLowerCase()}).` });
    }

    // Proveedor como tercero y cuenta sugerida por su regla
    if (doc.supplier.nit) {
      await this.acc.saveThirdPartyFor(c.id, { idType: '31', idNumber: doc.supplier.nit, name: doc.supplier.name || doc.supplier.nit, email: doc.supplier.email || undefined });
    }
    const rule = doc.supplier.nit ? await this.rules.findOne({ where: { companyId: c.id, supplierNit: doc.supplier.nit } }) : null;
    const notes: string[] = [];
    if (doc.kind === 'CreditNote') notes.push(`Nota crédito${doc.references.length ? ` de la factura ${doc.references.join(', ')}` : ''}: al aprobarla se registra el asiento contrario.`);
    if (!rule) notes.push('Proveedor sin regla: elige la cuenta de gasto.');
    return this.saveDoc({ ...fields, status: 'PENDIENTE', accountCode: rule?.accountCode || null, message: notes.join(' ') || null });
  }

  private async saveDoc(fields: Partial<AccInboxDocument>): Promise<IngestResult> {
    const saved = await this.docs.save(this.docs.create(fields));
    this.logger.log(`Factura recibida ${saved.number || '(sin número)'} de ${saved.supplierName || saved.fromAddress || '?'}: ${saved.status}`);
    return { id: saved.id, status: saved.status, number: saved.number, supplierName: saved.supplierName, message: saved.message };
  }

  // ═══════════════════════ Consulta

  async list(status?: string) {
    const c = await this.acc.company();
    const where: any = { companyId: c.id };
    if (status) where.status = In(String(status).split(','));
    return this.docs.find({ where, order: { receivedAt: 'DESC' }, take: 300 });
  }

  async get(id: string) {
    const c = await this.acc.company();
    const d = await this.docs.findOne({ where: { id, companyId: c.id } });
    if (!d) throw new NotFoundException('Documento no encontrado.');
    const preview = d.status === 'PENDIENTE' && d.accountCode ? this.preview(d, c, d.accountCode) : null;
    return { ...d, preview };
  }

  async pdf(id: string): Promise<{ name: string; data: Buffer }> {
    const c = await this.acc.company();
    const d = await this.docs.findOne({ where: { id, companyId: c.id }, select: ['id', 'pdf', 'pdfName', 'number'] });
    if (!d?.pdf) throw new NotFoundException('Este documento no trae PDF.');
    return { name: d.pdfName || `${d.number || 'factura'}.pdf`, data: d.pdf };
  }

  /** Asiento que se crearía con la cuenta dada (para mostrarlo antes de aprobar). */
  private preview(d: AccInboxDocument, c: any, accountCode: string) {
    try {
      return inboxVoucherLines(d, this.acc.accountMapOf(c), accountCode, null);
    } catch {
      return null;
    }
  }

  // ═══════════════════════ Revisión

  async approve(id: string, input: { accountCode: string; saveRule?: boolean; date?: string }, user: string) {
    const c = await this.acc.company();
    const d = await this.docs.findOne({ where: { id, companyId: c.id } });
    if (!d) throw new NotFoundException('Documento no encontrado.');
    if (d.status !== 'PENDIENTE') throw new BadRequestException('Solo se aprueban documentos pendientes.');
    const accountCode = String(input.accountCode || '').trim();
    if (!accountCode) throw new BadRequestException('Elige la cuenta de gasto.');
    const date = input.date && isDate(input.date) ? input.date : d.issueDate;
    if (!date) throw new BadRequestException('El documento no trae fecha: indícala.');

    const supplier = d.supplierNit ? await this.thirdParties.findOne({ where: { companyId: c.id, idNumber: d.supplierNit } }) : null;
    const { lines } = inboxVoucherLines(d, this.acc.accountMapOf(c), accountCode, supplier?.id || null);
    const voucher = await this.acc.postSourced({
      type: 'NC', date, lines, post: true, sourceKey: `INBOX:${d.cufe || d.id}`,
      description: `${d.kind === 'CreditNote' ? 'Nota crédito' : 'Factura'} proveedor ${d.number || ''} · ${d.supplierName || ''}`.trim(),
    }, user);

    if (input.saveRule && d.supplierNit) {
      const rule = await this.rules.findOne({ where: { companyId: c.id, supplierNit: d.supplierNit } });
      await this.rules.save(Object.assign(rule || this.rules.create({ companyId: c.id, supplierNit: d.supplierNit }), { accountCode }));
    }
    Object.assign(d, { status: 'CONTABILIZADA', accountCode, voucherId: voucher.id, reviewedBy: user, reviewedAt: new Date() });
    await this.docs.save(d);
    return { document: d, voucher };
  }

  async discard(id: string, reason: string | undefined, user: string) {
    const c = await this.acc.company();
    const d = await this.docs.findOne({ where: { id, companyId: c.id } });
    if (!d) throw new NotFoundException('Documento no encontrado.');
    if (d.status === 'CONTABILIZADA') throw new BadRequestException('Ya está contabilizado: si hay un error, reversa su comprobante.');
    Object.assign(d, { status: 'DESCARTADA', message: [d.message, `Descartada: ${String(reason || 'sin motivo').slice(0, 200)}`].filter(Boolean).join(' · '), reviewedBy: user, reviewedAt: new Date() });
    return this.docs.save(d);
  }

  /** Vuelve a dejar pendiente un documento descartado por error. */
  async reopen(id: string) {
    const c = await this.acc.company();
    const d = await this.docs.findOne({ where: { id, companyId: c.id } });
    if (!d) throw new NotFoundException('Documento no encontrado.');
    if (d.status !== 'DESCARTADA') throw new BadRequestException('Solo se reabren documentos descartados.');
    if (!d.number || !d.kind) throw new BadRequestException('Este documento no tiene factura electrónica para contabilizar.');
    d.status = 'PENDIENTE';
    return this.docs.save(d);
  }

  async rulesList() {
    const c = await this.acc.company();
    return this.rules.find({ where: { companyId: c.id }, order: { supplierNit: 'ASC' } });
  }
}
