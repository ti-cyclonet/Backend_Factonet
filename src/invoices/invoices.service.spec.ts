import { of, throwError } from 'rxjs';
import { InvoicesService } from './invoices.service';

const deAuthoriza = [
  {
    id: 1, code: 'DF00001', status: 'Issued', value: '89000.00', issueDate: '2026-09-03', expirationDate: '2026-10-10',
    globalParameters: { iva: 16910 }, operationTypes: { iva: 'add' }, percentages: { iva: 19 },
    user: { strUserName: 'cliente@x.co', basicData: { documentNumber: '901000000', strPersonType: 'J', legalEntityData: { businessName: 'Panadería La Espiga' } } },
    contract: { code: 'CT-1', mode: 'MONTHLY' },
  },
  { id: 2, code: 'DF00002', status: 'Unconfirmed', value: 50000, user: { strUserName: 'cliente@x.co' } },
];

function montar(get: jest.Mock = jest.fn(() => of({ data: deAuthoriza })), post: jest.Mock = jest.fn(() => of({ data: { ok: true } }))) {
  const http: any = { get, post, patch: jest.fn(() => of({ data: {} })) };
  const config: any = { get: (_k: string, d: string) => d };
  return { servicio: new InvoicesService(http, config), http };
}
const fallo = (status: number, message: any) => throwError(() => ({ message: 'x', response: { status, data: { message } } }));

describe('InvoicesService', () => {
  describe('findAll', () => {
    it('el cliente pide solo su tenant y no ve las facturas sin confirmar', async () => {
      const { servicio, http } = montar();
      const r = await servicio.findAll('t1', 'adminInvoices');
      expect(http.get.mock.calls[0][1].params).toEqual({ tenantId: 't1' });
      expect(http.get.mock.calls[0][1].headers['x-internal-key']).toBeDefined();
      expect(r.map((f: any) => f.id)).toEqual([1]);
    });

    it('el administrador pide todo y ve también las sin confirmar', async () => {
      const { servicio, http } = montar();
      const r = await servicio.findAll('t1', 'adminFactonet');
      expect(http.get.mock.calls[0][1].params).toEqual({});
      expect(r.map((f: any) => f.id)).toEqual([1, 2]);
    });

    it('otro rol: 403 sin llamar a Authoriza', async () => {
      const { servicio, http } = montar();
      await expect(servicio.findAll('t1', 'adminInout')).rejects.toMatchObject({ status: 403 });
      expect(http.get).not.toHaveBeenCalled();
    });

    it('traduce la factura de Authoriza a lo que usa el portal, con los conceptos sueltos', async () => {
      const { servicio } = montar();
      const [f] = await servicio.findAll('t1', 'adminInvoices');
      expect(f).toEqual(expect.objectContaining({
        id: 1, numero: 'DF00001', cliente: 'Panadería La Espiga', total: 89000, estado: 'Issued',
        fechaVencimiento: '2026-10-10', clienteNit: '901000000', contratoCode: 'CT-1', iva: 16910,
        operationTypes: { iva: 'add' },
      }));
    });

    it('si Authoriza falla responde error (502), no una lista vacía', async () => {
      const { servicio } = montar(jest.fn(() => fallo(500, 'boom')));
      await expect(servicio.findAll('t1', 'adminInvoices')).rejects.toMatchObject({ status: 502 });
    });
  });

  describe('assertInvoiceAccess', () => {
    it('el cliente solo opera sus facturas', async () => {
      const { servicio } = montar();
      await expect(servicio.assertInvoiceAccess(1, 't1', 'adminInvoices')).resolves.toBeUndefined();
      await expect(servicio.assertInvoiceAccess(99, 't1', 'adminInvoices')).rejects.toMatchObject({ status: 403 });
    });

    it('una factura sin confirmar no es "suya" todavía para el cliente', async () => {
      const { servicio } = montar();
      await expect(servicio.assertInvoiceAccess(2, 't1', 'adminInvoices')).rejects.toMatchObject({ status: 403 });
    });

    it('el administrador puede con cualquiera, sin consultar', async () => {
      const { servicio, http } = montar();
      await servicio.assertInvoiceAccess(99, undefined, 'adminFactonet');
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe('pagos', () => {
    const archivo = { buffer: Buffer.from('%PDF'), originalname: 'c.pdf', mimetype: 'application/pdf', size: 4 } as any;

    it('reportar sin constancia: 400 con mensaje, sin llamar a Authoriza', async () => {
      const { servicio, http } = montar();
      await expect(servicio.registerPayment(1, '2026-10-08', 105910)).rejects.toMatchObject({ status: 400 });
      expect(http.post).not.toHaveBeenCalled();
    });

    it('reportar con constancia la reenvía a Authoriza como multipart', async () => {
      const { servicio, http } = montar();
      await servicio.registerPayment(1, '2026-10-08', 105910, archivo);
      const [url, form, opciones] = http.post.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/invoices/1/register-payment');
      expect(opciones.headers['content-type']).toContain('multipart/form-data');
      expect(form.getBuffer().toString()).toContain('105910');
    });

    it('confirmar un pago que Authoriza rechaza (409) devuelve ese 409 y su mensaje', async () => {
      const { servicio } = montar(undefined, jest.fn(() => fallo(409, 'La factura no tiene un pago reportado por verificar.')));
      await expect(servicio.confirmPayment(1)).rejects.toMatchObject({
        status: 409, response: expect.objectContaining({ message: 'La factura no tiene un pago reportado por verificar.' }),
      });
    });

    it('rechazar envía el motivo', async () => {
      const { servicio, http } = montar();
      await servicio.rejectPayment(1, 'El valor no coincide');
      expect(http.post.mock.calls[0][1]).toEqual({ reason: 'El valor no coincide' });
    });
  });
});
