import { createHash } from 'crypto';
import { of, throwError } from 'rxjs';
import { PagosService, urlTransaccionWompi } from './pagos.service';
import { leerConfigPasarela } from './pasarela.config';

const ENV_ACTIVA = {
  PASARELA_ACTIVA: 'true', WOMPI_ENTORNO: 'sandbox', WOMPI_LLAVE_PUBLICA: 'pub_test_abc',
  WOMPI_SECRETO_INTEGRIDAD: 'integridad', WOMPI_SECRETO_EVENTOS: 'eventos', FACTONET_URL_PORTAL: 'https://portal',
};
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const tx = (o: any = {}) => ({
  id: 'TX-1', status: 'APPROVED', reference: 'FN-15-ABC', amount_in_cents: 10591000, currency: 'COP',
  finalized_at: '2026-10-08T15:00:00Z', ...o,
});
const evento = (t: any) => ({
  event: 'transaction.updated',
  data: { transaction: t },
  timestamp: 1,
  signature: {
    properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
    checksum: sha(`${t.id}${t.status}${t.amount_in_cents}1eventos`),
  },
});
const FACTURA = { id: 15, status: 'Issued', value: 89000, globalParameters: { iva: 16910 }, operationTypes: { iva: 'add' } };

/** Authoriza simulado: guarda el estado de la factura 15 y registra las llamadas. */
function montar(env: Record<string, string> = ENV_ACTIVA, factura: any = FACTURA) {
  const llamadas: string[] = [];
  let estado = { ...factura };
  const http: any = {
    get: jest.fn((url: string) => {
      llamadas.push(`GET ${url}`);
      return of({ data: { ...estado } });
    }),
    post: jest.fn((url: string, body: any) => {
      llamadas.push(`POST ${url}`);
      if (url.endsWith('/register-payment')) {
        estado = { ...estado, status: 'Payment Reported', paidAmount: body.paidAmount, paymentVoucherUrl: body.paymentVoucherUrl };
      }
      if (url.endsWith('/confirm-payment')) {
        if (estado.status !== 'Payment Reported') return throwError(() => ({ message: 'no', response: { status: 500, data: {} } }));
        estado = { ...estado, status: 'Paid' };
      }
      return of({ data: { ...estado } });
    }),
  };
  const invoices: any = {
    findAll: jest.fn(async () => [{ id: 15, estado: estado.status, total: 89000, iva: 16910, operationTypes: { iva: 'add' } }]),
    assertInvoiceAccess: jest.fn(async () => undefined),
  };
  const config: any = { get: (_k: string, d: string) => d };
  const servicio = new PagosService(http, config, invoices);
  jest.spyOn(servicio as any, 'config').mockImplementation(() => leerConfigPasarela(env));
  return { servicio, http, invoices, llamadas, estado: () => estado };
}

describe('PagosService', () => {
  it('apagada: la configuración pública lo dice y el checkout responde 503', async () => {
    const { servicio } = montar({});
    expect(servicio.configuracionPublica()).toEqual({ pasarelaActiva: false, proveedor: null });
    await expect(servicio.crearCheckout(15, { rol: 'adminInvoices', tenantId: 't' })).rejects.toMatchObject({ status: 503 });
  });

  it('apagada: un evento, aunque esté bien firmado, no se procesa', async () => {
    const { servicio, http } = montar({});
    await expect(servicio.procesarEvento(evento(tx()) as any)).rejects.toMatchObject({ status: 404 });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('checkout: monto calculado en el servidor (TOTAL con IVA) y firmado', async () => {
    const { servicio } = montar();
    const r = await servicio.crearCheckout(15, { rol: 'adminInvoices', tenantId: 't', email: 'c@x.co' });
    expect(r.total).toBe(105910);
    expect(r.montoEnCentavos).toBe(10591000);
    expect(r.url).toContain('amount-in-cents=10591000');
    expect(new URL(r.url).searchParams.get('redirect-url')).toBe('https://portal/invoices?pago=wompi');
  });

  it('checkout: el administrador no paga facturas y una factura ajena se rechaza', async () => {
    const { servicio } = montar();
    await expect(servicio.crearCheckout(15, { rol: 'adminFactonet' })).rejects.toMatchObject({ status: 403 });
    await expect(servicio.crearCheckout(99, { rol: 'adminInvoices', tenantId: 't' })).rejects.toMatchObject({ status: 403 });
  });

  it('evento aprobado por el total: registra el pago y lo confirma (queda Pagada)', async () => {
    const { servicio, llamadas, estado } = montar();
    const r = await servicio.procesarEvento(evento(tx()) as any);
    expect(r).toEqual({ estado: 'pagada', facturaId: 15 });
    expect(estado().status).toBe('Paid');
    expect(estado().paymentVoucherUrl).toBe(urlTransaccionWompi('TX-1'));
    expect(estado().paidAmount).toBe(105910);
    expect(llamadas.filter(l => l.startsWith('POST')).map(l => l.split('/').pop())).toEqual(['register-payment', 'confirm-payment']);
  });

  it('evento repetido: no vuelve a registrar una factura ya pagada', async () => {
    const { servicio, http } = montar();
    await servicio.procesarEvento(evento(tx()) as any);
    http.post.mockClear();
    expect(await servicio.procesarEvento(evento(tx()) as any)).toEqual({ estado: 'pagada', facturaId: 15 });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('el evento y el regreso del cliente a la vez: un solo registro y una sola confirmación', async () => {
    const { servicio, http } = montar();
    const [a, b] = await Promise.all([servicio.procesarEvento(evento(tx()) as any), servicio.aplicarTransaccion(tx() as any)]);
    expect(a.estado).toBe('pagada');
    expect(b.estado).toBe('pagada');
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('pagó menos del total (p. ej. la mora subió): queda en "Pago reportado" para el administrador', async () => {
    const { servicio, estado } = montar();
    const r = await servicio.procesarEvento(evento(tx({ amount_in_cents: 8900000 })) as any);
    expect(r.estado).toBe('por-verificar');
    expect(estado().status).toBe('Payment Reported');
  });

  it('ya había una constancia reportada por otro medio: no se pisa', async () => {
    const { servicio, http } = montar(ENV_ACTIVA, { ...FACTURA, status: 'Payment Reported', paymentVoucherUrl: 'https://res.cloudinary.com/x.pdf' });
    expect((await servicio.procesarEvento(evento(tx()) as any)).estado).toBe('por-verificar');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('transacción rechazada o pendiente: no toca la factura', async () => {
    const { servicio, http } = montar();
    expect((await servicio.procesarEvento(evento(tx({ status: 'DECLINED' })) as any)).estado).toBe('rechazada');
    expect((await servicio.procesarEvento(evento(tx({ status: 'PENDING' })) as any)).estado).toBe('pendiente');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('firma inválida: 401 y nada se registra', async () => {
    const { servicio, http } = montar();
    const e: any = evento(tx());
    e.signature.checksum = 'f'.repeat(64);
    await expect(servicio.procesarEvento(e)).rejects.toMatchObject({ status: 401 });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('referencia que no es de FactoNet: se ignora', async () => {
    const { servicio } = montar();
    expect((await servicio.procesarEvento(evento(tx({ reference: 'OTRA-COSA' })) as any)).estado).toBe('ignorada');
  });

  it('regreso del cliente: consulta la transacción en Wompi y verifica que la factura sea suya', async () => {
    const { servicio, http, invoices } = montar();
    http.get.mockImplementationOnce(() => of({ data: { data: tx() } }));
    const r = await servicio.verificarTransaccion('TX-1', { rol: 'adminInvoices', tenantId: 't' });
    expect(http.get.mock.calls[0][0]).toBe('https://sandbox.wompi.co/v1/transactions/TX-1');
    expect(invoices.assertInvoiceAccess).toHaveBeenCalledWith(15, 't', 'adminInvoices');
    expect(r.estado).toBe('pagada');
  });
});
