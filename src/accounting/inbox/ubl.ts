import { XMLParser } from 'fast-xml-parser';
import JSZip = require('jszip');

/**
 * Lectura de facturas electrónicas de proveedores (DIAN, UBL 2.1).
 *
 * El proveedor envía por correo un ZIP con el AttachedDocument (XML que trae
 * la factura o nota crédito embebida en cac:Attachment) y su PDF. Aquí no se
 * usa OCR: los valores salen del XML firmado, que es el soporte legal.
 */

export interface UblParty { nit: string; dv: string | null; name: string; email: string | null }
export interface UblLine { description: string; quantity: number; amount: number }
export interface SupplierDocument {
  kind: 'Invoice' | 'CreditNote';
  cufe: string | null;
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  supplier: UblParty;
  customer: UblParty;
  lines: UblLine[];
  /** Suma de las líneas − descuentos + cargos (base del gasto). */
  base: number;
  /** IVA (tributo 01). */
  iva: number;
  /** Otros tributos a cargo del comprador: INC (04), ICA (03), etc. */
  otherTaxes: number;
  /** Retenciones que trae el documento (05 ReteIVA, 06 ReteFuente, 07 ReteICA). */
  withholdings: { renta: number; iva: number; ica: number };
  /** Valor a pagar según el documento. */
  payable: number;
  /** La factura que corrige una nota crédito (si la trae). */
  references: string[];
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const ARRAYS = new Set(['TaxTotal', 'WithholdingTaxTotal', 'TaxSubtotal', 'InvoiceLine', 'CreditNoteLine', 'Attachment', 'BillingReference', 'Description', 'Note', 'AllowanceCharge']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  cdataPropName: false as any,
  isArray: (name) => ARRAYS.has(name),
});

/** Texto de un nodo (puede venir como string o como { '#text', '@attr' }). */
function txt(node: any): string {
  if (node === undefined || node === null) return '';
  if (Array.isArray(node)) return txt(node[0]);
  if (typeof node === 'object') return String(node['#text'] ?? '').trim();
  return String(node).trim();
}
const num = (node: any) => r2(Number(txt(node).replace(',', '.')) || 0);
const digits = (s: string) => String(s || '').replace(/\D/g, '');

/** NIT sin dígito de verificación, solo números (para comparar). */
export function nitBase(nit: string | null | undefined): string {
  const raw = String(nit || '').trim();
  // "901515884-3" → "901515884"; "9015158843" (con DV pegado) no se puede separar con certeza
  const m = raw.match(/^([\d.]+)\s*-\s*\d$/);
  return digits(m ? m[1] : raw);
}

function party(p: any): UblParty {
  const party = p?.Party || {};
  const scheme = party.PartyTaxScheme || {};
  const legal = party.PartyLegalEntity || {};
  const idNode = scheme.CompanyID ?? legal.CompanyID ?? party.PartyIdentification?.ID;
  const dv = typeof idNode === 'object' && !Array.isArray(idNode) ? (idNode['@schemeID'] ?? null) : null;
  const name = txt(scheme.RegistrationName) || txt(legal.RegistrationName) || txt(party.PartyName?.Name);
  const email = txt(party.Contact?.ElectronicMail) || null;
  return { nit: digits(txt(idNode)), dv: dv ? String(dv) : null, name, email };
}

function sumTaxes(totals: any[] | undefined, schemes: string[]): number {
  let total = 0;
  for (const t of totals || []) {
    const subs: any[] = t.TaxSubtotal || [];
    if (subs.length) {
      for (const s of subs) {
        const id = txt(s.TaxCategory?.TaxScheme?.ID);
        if (schemes.includes(id)) total += num(s.TaxAmount);
      }
    }
  }
  return r2(total);
}

/** Devuelve el XML de la factura o nota crédito, sacándolo del AttachedDocument si hace falta. */
export function unwrapAttachedDocument(xml: string): string {
  const doc = parser.parse(xml);
  if (doc.Invoice || doc.CreditNote) return xml;
  const attached = doc.AttachedDocument;
  if (!attached) throw new Error('El XML no es una factura electrónica (ni Invoice, ni CreditNote, ni AttachedDocument).');
  const desc = attached.Attachment?.[0]?.ExternalReference?.Description;
  const inner = txt(Array.isArray(desc) ? desc[0] : desc);
  if (!inner.includes('<')) throw new Error('El AttachedDocument no trae la factura embebida.');
  return inner;
}

/** Lee una factura o nota crédito electrónica (UBL 2.1 DIAN). */
export function parseSupplierDocument(xml: string): SupplierDocument {
  const innerXml = unwrapAttachedDocument(xml);
  const doc = parser.parse(innerXml);
  const kind: SupplierDocument['kind'] = doc.CreditNote ? 'CreditNote' : 'Invoice';
  const d = doc.CreditNote || doc.Invoice;
  if (!d) throw new Error('No se encontró la factura dentro del XML.');

  const money = d.LegalMonetaryTotal || {};
  const lineNodes: any[] = (kind === 'CreditNote' ? d.CreditNoteLine : d.InvoiceLine) || [];
  const lines: UblLine[] = lineNodes.map((l) => ({
    description: (l.Item?.Description || []).map(txt).filter(Boolean).join(' ') || txt(l.Item?.Name) || 'Ítem',
    quantity: num(kind === 'CreditNote' ? l.CreditedQuantity : l.InvoicedQuantity) || 1,
    amount: num(l.LineExtensionAmount),
  }));

  const lineExtension = num(money.LineExtensionAmount) || r2(lines.reduce((s, l) => s + l.amount, 0));
  const base = r2(lineExtension - num(money.AllowanceTotalAmount) + num(money.ChargeTotalAmount));
  const iva = sumTaxes(d.TaxTotal, ['01']);
  const otherTaxes = sumTaxes(d.TaxTotal, ['02', '03', '04', '22', '24', '25', '26', 'ZZ']);
  const withholdings = {
    iva: sumTaxes(d.WithholdingTaxTotal, ['05']),
    renta: sumTaxes(d.WithholdingTaxTotal, ['06']),
    ica: sumTaxes(d.WithholdingTaxTotal, ['07']),
  };
  const number = txt(d.ID);
  if (!number) throw new Error('La factura no trae número.');

  return {
    kind,
    cufe: txt(d.UUID) || null,
    number,
    issueDate: txt(d.IssueDate).slice(0, 10),
    dueDate: txt(d.DueDate).slice(0, 10) || txt(d.PaymentMeans?.PaymentDueDate).slice(0, 10) || null,
    currency: txt(d.DocumentCurrencyCode) || 'COP',
    supplier: party(d.AccountingSupplierParty),
    customer: party(d.AccountingCustomerParty),
    lines,
    base,
    iva,
    otherTaxes,
    withholdings,
    payable: num(money.PayableAmount) || r2(base + iva + otherTaxes),
    references: (d.BillingReference || []).map((b: any) => txt(b.InvoiceDocumentReference?.ID)).filter(Boolean),
  };
}

export interface ExtractedFile { name: string; data: Buffer }

/** Límites contra adjuntos abusivos (bombas zip, correos enormes). */
const MAX_FILE = 10 * 1024 * 1024;
const MAX_UNZIPPED = 20 * 1024 * 1024;

/**
 * Separa los XML y PDF de un conjunto de adjuntos (abre los ZIP, un nivel).
 * Los XML que no son facturas (p. ej. ApplicationResponse suelto) se filtran
 * después, al intentar leerlos.
 */
export async function extractDocuments(files: ExtractedFile[]): Promise<{ xmls: ExtractedFile[]; pdfs: ExtractedFile[] }> {
  const xmls: ExtractedFile[] = [];
  const pdfs: ExtractedFile[] = [];
  for (const f of files) {
    if (!f?.data?.length || f.data.length > MAX_FILE) continue;
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.zip') || (f.data[0] === 0x50 && f.data[1] === 0x4b)) {
      const zip = await JSZip.loadAsync(f.data);
      let total = 0;
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || entry.name.includes('..')) continue;
        const n = entry.name.toLowerCase();
        if (!n.endsWith('.xml') && !n.endsWith('.pdf')) continue;
        const data = await entry.async('nodebuffer');
        total += data.length;
        if (total > MAX_UNZIPPED) throw new Error('El ZIP es demasiado grande.');
        (n.endsWith('.xml') ? xmls : pdfs).push({ name: entry.name.split('/').pop()!, data });
      }
    } else if (lower.endsWith('.xml')) {
      xmls.push(f);
    } else if (lower.endsWith('.pdf') || f.data.subarray(0, 4).toString() === '%PDF') {
      pdfs.push(f);
    }
  }
  return { xmls, pdfs };
}
