import { createHash } from 'crypto';
import { eventoValido, facturaDeReferencia, fechaBogota, firmaIntegridad, referenciaPago, urlCheckout } from './wompi';
import { leerConfigPasarela } from './pasarela.config';
import { totalAPagar } from './total-factura';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('wompi', () => {
  it('firma de integridad = SHA256(referencia + centavos + moneda + secreto)', () => {
    expect(firmaIntegridad('FN-1-ABC', 10591000, 'COP', 'secreto')).toBe(sha('FN-1-ABC10591000COPsecreto'));
  });

  it('la referencia lleva el id de la factura y se puede leer de vuelta', () => {
    const ref = referenciaPago(42, 1_700_000_000_000);
    expect(ref).toMatch(/^FN-42-[0-9A-Z]+$/);
    expect(facturaDeReferencia(ref)).toBe(42);
    expect(facturaDeReferencia('OTRA-42-X')).toBeNull();
    expect(facturaDeReferencia('')).toBeNull();
  });

  it('la URL del checkout lleva monto, referencia, firma y retorno', () => {
    const url = new URL(urlCheckout(
      { llavePublica: 'pub_test_x', secretoIntegridad: 's', secretoEventos: 'e', entorno: 'sandbox' },
      { referencia: 'FN-7-Z', montoEnCentavos: 5000, urlRetorno: 'https://portal/invoices?pago=wompi', email: 'a@b.co' },
    ));
    expect(url.origin + url.pathname).toBe('https://checkout.wompi.co/p/');
    expect(url.searchParams.get('public-key')).toBe('pub_test_x');
    expect(url.searchParams.get('amount-in-cents')).toBe('5000');
    expect(url.searchParams.get('currency')).toBe('COP');
    expect(url.searchParams.get('signature:integrity')).toBe(firmaIntegridad('FN-7-Z', 5000, 'COP', 's'));
    expect(url.searchParams.get('redirect-url')).toBe('https://portal/invoices?pago=wompi');
    expect(url.searchParams.get('customer-data:email')).toBe('a@b.co');
  });

  describe('eventoValido', () => {
    const tx = { id: '1234-1610641025-49201', status: 'APPROVED', amount_in_cents: 4490000, reference: 'FN-1-A', currency: 'COP' };
    const firmado = (secreto: string) => ({
      event: 'transaction.updated',
      data: { transaction: tx },
      timestamp: 1530291411,
      signature: {
        properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
        checksum: sha(`${tx.id}${tx.status}${tx.amount_in_cents}1530291411${secreto}`),
      },
    });

    it('acepta el evento firmado con el secreto correcto', () => {
      expect(eventoValido(firmado('eventos') as any, 'eventos')).toBe(true);
    });

    it('rechaza otro secreto, datos alterados y eventos sin firma', () => {
      expect(eventoValido(firmado('otro') as any, 'eventos')).toBe(false);
      const alterado: any = firmado('eventos');
      alterado.data = { transaction: { ...tx, amount_in_cents: 100 } };
      expect(eventoValido(alterado, 'eventos')).toBe(false);
      expect(eventoValido({ event: 'x', data: { transaction: tx } } as any, 'eventos')).toBe(false);
      expect(eventoValido(firmado('eventos') as any, '')).toBe(false);
    });
  });

  it('fechaBogota: un pago a las 9 p. m. del 8 en Bogotá es del 8, aunque en UTC ya sea el 9', () => {
    expect(fechaBogota('2026-10-09T02:00:00Z')).toBe('2026-10-08');
    expect(fechaBogota('2026-10-08T15:00:00Z')).toBe('2026-10-08');
  });
});

describe('leerConfigPasarela', () => {
  const completa = {
    PASARELA_ACTIVA: 'true', WOMPI_ENTORNO: 'sandbox', WOMPI_LLAVE_PUBLICA: 'pub_test_abc',
    WOMPI_SECRETO_INTEGRIDAD: 'test_integrity_x', WOMPI_SECRETO_EVENTOS: 'test_events_y', FACTONET_URL_PORTAL: 'https://portal/',
  };

  it('apagada por defecto', () => {
    expect(leerConfigPasarela({}).activa).toBe(false);
  });

  it('con llaves pero sin PASARELA_ACTIVA=true sigue apagada', () => {
    expect(leerConfigPasarela({ ...completa, PASARELA_ACTIVA: '' }).activa).toBe(false);
  });

  it('encendida y completa', () => {
    const c = leerConfigPasarela(completa);
    expect(c.activa).toBe(true);
    expect(c.urlPortal).toBe('https://portal');
  });

  it('encendida pero incompleta no se activa y dice qué falta', () => {
    const c = leerConfigPasarela({ ...completa, WOMPI_SECRETO_EVENTOS: '' });
    expect(c.activa).toBe(false);
    expect(c.faltantes).toEqual(['WOMPI_SECRETO_EVENTOS']);
  });

  it('una llave de pruebas en producción no se activa', () => {
    const c = leerConfigPasarela({ ...completa, WOMPI_ENTORNO: 'produccion' });
    expect(c.activa).toBe(false);
    expect(c.faltantes[0]).toContain('pub_prod_');
  });
});

describe('totalAPagar', () => {
  it('factura de FactoNet: total más y menos conceptos, como la pantalla', () => {
    expect(totalAPagar({
      total: 89000, iva: 16910, global_discount: 1000, late_fee_penalty: 500,
      operationTypes: { iva: 'add', global_discount: 'subtract', late_fee_penalty: 'add' },
    })).toBe(105410);
  });

  it('factura de Authoriza: value y conceptos dentro de globalParameters', () => {
    expect(totalAPagar({ value: '89000.00', globalParameters: { iva: 16910 }, operationTypes: { iva: 'add' } })).toBe(105910);
  });

  it('sin conceptos es el valor base', () => {
    expect(totalAPagar({ total: 50000 })).toBe(50000);
    expect(totalAPagar(null)).toBe(0);
  });
});
