/**
 * Facturas electrónicas de ejemplo (estructura UBL 2.1 DIAN) para pruebas.
 * Datos ficticios.
 */
export interface FixtureOpts {
  kind?: 'Invoice' | 'CreditNote';
  number?: string;
  cufe?: string;
  supplierNit?: string;
  supplierName?: string;
  customerNit?: string;
  base?: number;
  iva?: number;
  reteRenta?: number;
  issueDate?: string;
}

export function invoiceXml(o: FixtureOpts = {}): string {
  const kind = o.kind || 'Invoice';
  const base = o.base ?? 100000;
  const iva = o.iva ?? 19000;
  const rete = o.reteRenta ?? 0;
  const lineTag = kind === 'CreditNote' ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = kind === 'CreditNote' ? 'CreditedQuantity' : 'InvoicedQuantity';
  return `<?xml version="1.0" encoding="UTF-8"?>
<${kind} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${kind}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:ID>${o.number || 'FE1234'}</cbc:ID>
  <cbc:UUID schemeID="1" schemeName="CUFE-SHA384">${o.cufe || 'a1b2c3d4e5f6'}</cbc:UUID>
  <cbc:IssueDate>${o.issueDate || '2026-11-05'}</cbc:IssueDate>
  <cbc:DueDate>2026-12-05</cbc:DueDate>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  ${kind === 'CreditNote' ? '<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>FE1200</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>' : ''}
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${o.supplierName || 'Hosting Andino S.A.S.'}</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="7" schemeName="31">${o.supplierNit || '900111222'}</cbc:CompanyID>
      </cac:PartyTaxScheme>
      <cac:Contact><cbc:ElectronicMail>facturas@hosting.example</cbc:ElectronicMail></cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>CYCLONET S.A.S.</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="3" schemeName="31">${o.customerNit || '901515884'}</cbc:CompanyID>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">${iva}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">${base}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">${iva}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:Percent>19.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  ${rete ? `<cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="COP">${rete}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">${base}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">${rete}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:Percent>4.00</cbc:Percent><cac:TaxScheme><cbc:ID>06</cbc:ID><cbc:Name>ReteRenta</cbc:Name></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>` : ''}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">${base}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">${base}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">${base + iva}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">${base + iva}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:${lineTag}>
    <cbc:ID>1</cbc:ID>
    <cbc:${qtyTag} unitCode="94">1</cbc:${qtyTag}>
    <cbc:LineExtensionAmount currencyID="COP">${base}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>Servidor virtual mensual</cbc:Description></cac:Item>
  </cac:${lineTag}>
</${kind}>`;
}

/** AttachedDocument como lo envían los proveedores tecnológicos (factura en CDATA). */
export function attachedDocumentXml(o: FixtureOpts = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:ID>${o.number || 'FE1234'}</cbc:ID>
  <cac:Attachment>
    <cac:ExternalReference>
      <cbc:MimeCode>text/xml</cbc:MimeCode>
      <cbc:EncodingCode>UTF-8</cbc:EncodingCode>
      <cbc:Description><![CDATA[${invoiceXml(o)}]]></cbc:Description>
    </cac:ExternalReference>
  </cac:Attachment>
  <cac:ParentDocumentLineReference>
    <cbc:LineID>1</cbc:LineID>
    <cac:DocumentReference>
      <cbc:ID>${o.number || 'FE1234'}</cbc:ID>
      <cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[<ApplicationResponse>validada</ApplicationResponse>]]></cbc:Description></cac:ExternalReference></cac:Attachment>
    </cac:DocumentReference>
  </cac:ParentDocumentLineReference>
</AttachedDocument>`;
}
