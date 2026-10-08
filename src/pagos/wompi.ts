import { createHash, timingSafeEqual } from 'crypto';

/**
 * Integración con Wompi (Bancolombia): PSE, tarjetas, Nequi y botón Bancolombia
 * con un solo checkout web. Funciones puras: firmas, URL de pago y verificación
 * de eventos. Referencia: https://docs.wompi.co (Web Checkout, Eventos).
 * Al activar la pasarela, verificar contra la documentación vigente.
 */

export type EntornoWompi = 'sandbox' | 'produccion';

export interface ConfigWompi {
  llavePublica: string;
  secretoIntegridad: string;
  secretoEventos: string;
  entorno: EntornoWompi;
}

export interface TransaccionWompi {
  id: string;
  status: 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR' | 'PENDING' | string;
  reference: string;
  amount_in_cents: number;
  currency: string;
  payment_method_type?: string;
  created_at?: string;
  finalized_at?: string | null;
  [k: string]: any;
}

export interface EventoWompi {
  event: string;
  data: { transaction: TransaccionWompi };
  environment?: string;
  signature: { properties: string[]; checksum: string };
  timestamp: number;
  sent_at?: string;
}

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

export const URL_CHECKOUT = 'https://checkout.wompi.co/p/';

export function urlApi(entorno: EntornoWompi): string {
  return entorno === 'produccion' ? 'https://production.wompi.co/v1' : 'https://sandbox.wompi.co/v1';
}

/**
 * Referencia única por intento de pago: FN-<id de factura>-<marca de tiempo>.
 * Wompi exige que no se repita; el id de factura permite saber qué pagar al
 * recibir el evento.
 */
export function referenciaPago(facturaId: number, ahora: number = Date.now()): string {
  return `FN-${facturaId}-${ahora.toString(36).toUpperCase()}`;
}

/** Id de la factura dentro de una referencia de FactoNet, o null si no es nuestra. */
export function facturaDeReferencia(referencia: string): number | null {
  const m = /^FN-(\d+)-[0-9A-Z]+$/.exec(referencia || '');
  return m ? Number(m[1]) : null;
}

/** Firma de integridad: SHA256(referencia + montoEnCentavos + moneda + secretoIntegridad). */
export function firmaIntegridad(referencia: string, montoEnCentavos: number, moneda: string, secretoIntegridad: string): string {
  return sha256(`${referencia}${montoEnCentavos}${moneda}${secretoIntegridad}`);
}

/** URL del checkout web de Wompi para pagar `montoEnCentavos` en COP. */
export function urlCheckout(cfg: ConfigWompi, p: { referencia: string; montoEnCentavos: number; urlRetorno: string; email?: string }): string {
  const q = new URLSearchParams({
    'public-key': cfg.llavePublica,
    currency: 'COP',
    'amount-in-cents': String(p.montoEnCentavos),
    reference: p.referencia,
    'signature:integrity': firmaIntegridad(p.referencia, p.montoEnCentavos, 'COP', cfg.secretoIntegridad),
    'redirect-url': p.urlRetorno,
  });
  if (p.email) q.set('customer-data:email', p.email);
  return `${URL_CHECKOUT}?${q.toString()}`;
}

/** Valor de una ruta como "transaction.amount_in_cents" dentro de `data`. */
function valorEnRuta(data: any, ruta: string): unknown {
  return ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
}

/**
 * Verifica que el evento lo firmó Wompi: SHA256 de los valores de
 * `signature.properties` (en orden, tomados de `data`) + `timestamp` + secreto
 * de eventos, comparado en tiempo constante con `signature.checksum`.
 */
export function eventoValido(evento: EventoWompi, secretoEventos: string): boolean {
  const props = evento?.signature?.properties;
  const checksum = String(evento?.signature?.checksum || '').toLowerCase();
  if (!secretoEventos || !Array.isArray(props) || !props.length || !checksum || evento.timestamp == null) return false;
  const concatenado = props.map(p => String(valorEnRuta(evento.data, p) ?? '')).join('') + String(evento.timestamp) + secretoEventos;
  const esperado = sha256(concatenado);
  const a = Buffer.from(esperado);
  const b = Buffer.from(checksum);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fecha 'YYYY-MM-DD' en Bogotá (UTC-5, sin horario de verano) de un instante ISO. */
export function fechaBogota(iso?: string | null, ahora: Date = new Date()): string {
  const t = iso ? new Date(iso) : ahora;
  const base = isNaN(t.getTime()) ? ahora : t;
  return new Date(base.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}
