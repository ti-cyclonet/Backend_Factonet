import JSZip = require('jszip');
import { extractDocuments, nitBase, parseSupplierDocument } from './ubl';
import { attachedDocumentXml, invoiceXml } from './fixtures';

describe('Lectura de facturas electrónicas de proveedores (UBL 2.1)', () => {
  it('lee la factura embebida en el AttachedDocument', () => {
    const d = parseSupplierDocument(attachedDocumentXml({ reteRenta: 4000 }));
    expect(d).toEqual(expect.objectContaining({
      kind: 'Invoice', number: 'FE1234', cufe: 'a1b2c3d4e5f6', issueDate: '2026-11-05', dueDate: '2026-12-05', currency: 'COP',
      base: 100000, iva: 19000, otherTaxes: 0, payable: 119000,
    }));
    expect(d.supplier).toEqual({ nit: '900111222', dv: '7', name: 'Hosting Andino S.A.S.', email: 'facturas@hosting.example' });
    expect(d.customer.nit).toBe('901515884');
    expect(d.withholdings).toEqual({ renta: 4000, iva: 0, ica: 0 });
    expect(d.lines).toEqual([{ description: 'Servidor virtual mensual', quantity: 1, amount: 100000 }]);
  });

  it('lee una factura suelta (sin AttachedDocument) y una nota crédito', () => {
    expect(parseSupplierDocument(invoiceXml({ number: 'X9' })).number).toBe('X9');
    const nc = parseSupplierDocument(attachedDocumentXml({ kind: 'CreditNote', number: 'NC5', base: 20000, iva: 3800 }));
    expect(nc).toEqual(expect.objectContaining({ kind: 'CreditNote', number: 'NC5', base: 20000, iva: 3800, references: ['FE1200'] }));
    expect(nc.lines[0].quantity).toBe(1);
  });

  it('rechaza XML que no son facturas', () => {
    expect(() => parseSupplierDocument('<ApplicationResponse><ID>1</ID></ApplicationResponse>')).toThrow(/no es una factura/);
  });

  it('compara NIT sin dígito de verificación', () => {
    expect(nitBase('901515884-3')).toBe('901515884');
    expect(nitBase('901.515.884-3')).toBe('901515884');
    expect(nitBase('901515884')).toBe('901515884');
  });

  it('abre el ZIP del correo y separa XML y PDF', async () => {
    const zip = new JSZip();
    zip.file('ad09001112220002600001234.xml', attachedDocumentXml());
    zip.file('ad09001112220002600001234.pdf', Buffer.from('%PDF-1.4 demo'));
    const data = await zip.generateAsync({ type: 'nodebuffer' });
    const r = await extractDocuments([{ name: 'z09001112220002600001234.zip', data }, { name: 'logo.png', data: Buffer.from('x') }]);
    expect(r.xmls.map((f) => f.name)).toEqual(['ad09001112220002600001234.xml']);
    expect(r.pdfs.map((f) => f.name)).toEqual(['ad09001112220002600001234.pdf']);
  });
});
