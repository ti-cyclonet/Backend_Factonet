import { BadRequestException, HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { errorDeAuthoriza } from './authoriza-error';
import { RegisterPaymentDto } from '../invoices/dto/register-payment.dto';

const deAxios = (status: number, data: any) => ({ message: `Request failed with status code ${status}`, response: { status, data } });

describe('errorDeAuthoriza', () => {
  it('conserva el 4xx y el mensaje que dio Authoriza', () => {
    const e = errorDeAuthoriza(deAxios(409, { message: 'La factura ya está pagada' }), 'respaldo');
    expect(e.getStatus()).toBe(409);
    expect((e.getResponse() as any).message).toBe('La factura ya está pagada');
  });

  it('une los mensajes de validación que llegan como arreglo', () => {
    const e = errorDeAuthoriza(deAxios(400, { message: ['paidAmount inválido', 'falta la fecha'] }), 'respaldo');
    expect((e.getResponse() as any).message).toBe('paidAmount inválido. falta la fecha');
  });

  it('un 5xx o un fallo de red se vuelve 502 con el mensaje de respaldo, sin filtrar detalles internos', () => {
    expect(errorDeAuthoriza(deAxios(500, { message: 'QueryFailedError: ...' }), 'No se pudo').getStatus()).toBe(502);
    const sinRed = errorDeAuthoriza(new Error('connect ECONNREFUSED'), 'No se pudo registrar el pago.');
    expect(sinRed.getStatus()).toBe(502);
    expect((sinRed.getResponse() as any).message).toBe('No se pudo registrar el pago.');
  });

  it('un 401 de Authoriza (clave interna) no se reenvía como 401, para no cerrar la sesión del usuario', () => {
    expect(errorDeAuthoriza(deAxios(401, { message: 'Unauthorized' }), 'No se pudo').getStatus()).toBe(502);
  });

  it('deja pasar las excepciones HTTP propias (p. ej. la constancia faltante)', () => {
    const propia = new BadRequestException('La constancia de pago es obligatoria.');
    expect(errorDeAuthoriza(propia, 'respaldo')).toBe(propia);
  });

  it('un 4xx sin mensaje usa el de respaldo', () => {
    const e: HttpException = errorDeAuthoriza(deAxios(404, ''), 'No se encontró la factura.');
    expect(e.getStatus()).toBe(404);
    expect((e.getResponse() as any).message).toBe('No se encontró la factura.');
  });
});

describe('RegisterPaymentDto', () => {
  const errores = async (body: any) => (await validate(plainToInstance(RegisterPaymentDto, body))).map(e => e.property);

  it('acepta el valor como texto, como llega en el multipart', async () => {
    expect(await errores({ paymentDate: '2026-10-08', paidAmount: '150000' })).toEqual([]);
  });

  it('rechaza un valor vacío, cero o no numérico y una fecha inválida', async () => {
    expect(await errores({ paymentDate: '2026-10-08', paidAmount: '' })).toEqual(['paidAmount']);
    expect(await errores({ paymentDate: '2026-10-08', paidAmount: '0' })).toEqual(['paidAmount']);
    expect(await errores({ paymentDate: '2026-10-08', paidAmount: 'abc' })).toEqual(['paidAmount']);
    expect(await errores({ paymentDate: 'ayer', paidAmount: '100' })).toEqual(['paymentDate']);
  });
});
