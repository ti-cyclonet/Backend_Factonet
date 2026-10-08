/**
 * TOTAL a pagar de una factura, con la misma regla que la pantalla y el PDF
 * (calculateFinalTotal del frontend): valor base más o menos cada concepto
 * (IVA, descuentos, mora) según su tipo de operación.
 *
 * Acepta las dos formas en que llega una factura:
 * - la de FactoNet (mapInvoices): `total` y los conceptos como campos sueltos;
 * - la de Authoriza: `value` y los conceptos dentro de `globalParameters`.
 *
 * Al listar facturas, Authoriza ya incluye en los conceptos la mora del día
 * (late_fee_penalty), así que este total es lo que se debe hoy.
 */
export function totalAPagar(factura: any): number {
  if (!factura) return 0;
  const base = Number(factura.total ?? factura.value) || 0;
  const conceptos = factura.globalParameters || factura;
  const operaciones: Record<string, string> = factura.operationTypes || {};
  let total = base;
  for (const [clave, operacion] of Object.entries(operaciones)) {
    const valor = Number(conceptos[clave]);
    if (!valor || !operacion) continue;
    total += operacion === 'subtract' ? -valor : valor;
  }
  return Math.round(total * 100) / 100;
}

/** Estados en los que el cliente puede pagar (emitida y sin pago reportado). */
export const ESTADOS_PAGABLES = ['Issued', 'In arrears', 'Notification1', 'Notification2', 'Suspended'];
