import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { InvoicesService } from '../invoices/invoices.service';
import { authorizaInternalHeaders } from '../common/authoriza-internal';
import { errorDeAuthoriza } from '../common/authoriza-error';
import { ConfigPasarela, leerConfigPasarela } from './pasarela.config';
import { ESTADOS_PAGABLES, totalAPagar } from './total-factura';
import {
  EventoWompi, TransaccionWompi, eventoValido, facturaDeReferencia, fechaBogota, referenciaPago, urlApi, urlCheckout,
} from './wompi';

/** Lo que queda como "constancia" de un pago en línea: el enlace a la transacción en el panel de Wompi. */
export const urlTransaccionWompi = (id: string) => `https://comercios.wompi.co/transactions/${encodeURIComponent(id)}`;

/** Margen por redondeo entre el total en pesos y el monto en centavos que cobra Wompi. */
const TOLERANCIA_PESOS = 1;

export type ResultadoPago =
  | { estado: 'pagada'; facturaId: number }
  | { estado: 'por-verificar'; facturaId: number; motivo: string }
  | { estado: 'pendiente' | 'rechazada'; facturaId: number | null; estadoWompi: string }
  | { estado: 'ignorada'; motivo: string };

@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);
  private readonly authorizaUrl: string;
  /** Un pago por factura a la vez: el evento de Wompi y el regreso del cliente pueden llegar juntos. */
  private readonly enCurso = new Map<number, Promise<ResultadoPago>>();

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
    private readonly invoices: InvoicesService,
  ) {
    this.authorizaUrl = this.configService.get<string>('AUTH_SERVICE_URL', 'http://localhost:3000');
  }

  /** Se lee en cada llamada: activar o apagar la pasarela solo requiere cambiar el entorno y reiniciar. */
  protected config(): ConfigPasarela {
    return leerConfigPasarela();
  }

  /** Lo que el portal necesita saber para mostrar u ocultar "Pagar en línea". Sin llaves ni secretos. */
  configuracionPublica() {
    const cfg = this.config();
    return { pasarelaActiva: cfg.activa, proveedor: cfg.activa ? 'wompi' : null };
  }

  private exigirActiva(): ConfigPasarela {
    const cfg = this.config();
    if (!cfg.activa) throw new ServiceUnavailableException('El pago en línea no está habilitado. Reporta tu pago con la constancia.');
    return cfg;
  }

  /**
   * Crea el intento de pago de una factura del cliente y devuelve la URL de
   * Wompi. El monto lo calcula el servidor (TOTAL con conceptos y mora del día):
   * el navegador no lo puede cambiar porque va firmado.
   */
  async crearCheckout(facturaId: number, usuario: { tenantId?: string; rol?: string; email?: string }) {
    const cfg = this.exigirActiva();
    if (usuario?.rol !== 'adminInvoices') throw new ForbiddenException('Solo el cliente puede pagar sus facturas en línea.');

    const propias = await this.invoices.findAll(usuario.tenantId, usuario.rol);
    const factura = propias.find((f: any) => Number(f.id) === Number(facturaId));
    if (!factura) throw new ForbiddenException('Esta factura no pertenece a tu cuenta.');
    if (!ESTADOS_PAGABLES.includes(factura.estado)) {
      throw new ConflictException(factura.estado === 'Payment Reported'
        ? 'Ya hay un pago reportado para esta factura; espera su verificación.'
        : 'Esta factura no tiene saldo por pagar.');
    }

    const total = totalAPagar(factura);
    if (!(total > 0)) throw new ConflictException('Esta factura no tiene saldo por pagar.');
    const montoEnCentavos = Math.round(total * 100);
    const referencia = referenciaPago(Number(factura.id));
    const urlRetorno = `${cfg.urlPortal}/invoices?pago=wompi`;

    this.logger.log(`Checkout Wompi: factura ${factura.id}, referencia ${referencia}, ${montoEnCentavos} centavos`);
    return {
      url: urlCheckout(cfg.wompi, { referencia, montoEnCentavos, urlRetorno, email: usuario.email }),
      referencia,
      montoEnCentavos,
      total,
    };
  }

  /**
   * Evento de Wompi (webhook). Solo se acepta si la firma es válida; un
   * evento de otra cosa o de una transacción no aprobada se ignora con 200
   * para que Wompi no lo reintente.
   */
  async procesarEvento(evento: EventoWompi): Promise<ResultadoPago> {
    const cfg = this.config();
    // Apagada: no se procesa nada, aunque llegue un evento bien firmado.
    if (!cfg.activa) throw new NotFoundException();
    if (!eventoValido(evento, cfg.wompi.secretoEventos)) {
      this.logger.warn('Evento de Wompi con firma inválida; se descarta');
      throw new UnauthorizedException('Firma inválida.');
    }
    if (evento.event !== 'transaction.updated' || !evento.data?.transaction) {
      return { estado: 'ignorada', motivo: `evento ${evento.event}` };
    }
    return this.aplicarTransaccion(evento.data.transaction);
  }

  /**
   * Al volver de Wompi el cliente trae el id de la transacción. Se consulta a
   * Wompi (no se confía en lo que diga la URL) y se aplica igual que el
   * evento: si el webhook no llegó o llegó tarde, el pago queda registrado.
   */
  async verificarTransaccion(transaccionId: string, usuario: { tenantId?: string; rol?: string }): Promise<ResultadoPago> {
    const cfg = this.exigirActiva();
    if (!/^[\w-]{4,80}$/.test(transaccionId || '')) throw new BadRequestException('Transacción inválida.');

    let tx: TransaccionWompi;
    try {
      const r = await firstValueFrom(this.http.get(`${urlApi(cfg.wompi.entorno)}/transactions/${encodeURIComponent(transaccionId)}`));
      tx = r.data?.data;
    } catch (error) {
      if (error?.response?.status === 404) throw new NotFoundException('No encontramos esa transacción en Wompi.');
      this.logger.error(`Wompi no respondió al consultar ${transaccionId}: ${error.message}`);
      throw new ServiceUnavailableException('No pudimos consultar el pago en Wompi. Intenta de nuevo en un momento.');
    }
    if (!tx?.reference) throw new NotFoundException('No encontramos esa transacción en Wompi.');

    const facturaId = facturaDeReferencia(tx.reference);
    if (facturaId == null) throw new BadRequestException('La transacción no corresponde a una factura de FactoNet.');
    await this.invoices.assertInvoiceAccess(facturaId, usuario?.tenantId, usuario?.rol);
    return this.aplicarTransaccion(tx);
  }

  /** Aplica una transacción de Wompi a su factura, una a la vez por factura. */
  async aplicarTransaccion(tx: TransaccionWompi): Promise<ResultadoPago> {
    const facturaId = facturaDeReferencia(tx?.reference);
    if (facturaId == null) return { estado: 'ignorada', motivo: `referencia ajena: ${tx?.reference}` };

    const previo = this.enCurso.get(facturaId);
    const turno = (previo || Promise.resolve(null as any))
      .catch(() => null)
      .then(() => this.aplicarSinConcurrencia(facturaId, tx));
    this.enCurso.set(facturaId, turno);
    try {
      return await turno;
    } finally {
      if (this.enCurso.get(facturaId) === turno) this.enCurso.delete(facturaId);
    }
  }

  private async aplicarSinConcurrencia(facturaId: number, tx: TransaccionWompi): Promise<ResultadoPago> {
    if (tx.status !== 'APPROVED') {
      const estado = tx.status === 'PENDING' ? 'pendiente' : 'rechazada';
      this.logger.log(`Transacción ${tx.id} de la factura ${facturaId}: ${tx.status}`);
      return { estado, facturaId, estadoWompi: tx.status };
    }
    if (tx.currency !== 'COP') return { estado: 'ignorada', motivo: `moneda ${tx.currency}` };

    const constancia = urlTransaccionWompi(tx.id);
    const pagado = Math.round(Number(tx.amount_in_cents)) / 100;
    let factura = await this.facturaAuthoriza(facturaId);

    if (factura.status === 'Paid') {
      return { estado: 'pagada', facturaId };
    }
    if (factura.status === 'Payment Reported' && factura.paymentVoucherUrl !== constancia) {
      // Ya había un pago reportado por otro medio (constancia): no se pisa; el administrador decide.
      this.logger.warn(`Factura ${facturaId}: pago en línea ${tx.id} aprobado pero ya tenía otro pago reportado`);
      return { estado: 'por-verificar', facturaId, motivo: 'La factura ya tenía otro pago reportado.' };
    }

    if (factura.status !== 'Payment Reported') {
      // registerPayment congela la mora a la fecha del pago y deja la factura en "Pago reportado"
      factura = await this.llamarAuthoriza('post', `/api/invoices/${facturaId}/register-payment`, {
        paymentDate: fechaBogota(tx.finalized_at || tx.created_at),
        paidAmount: pagado,
        paymentVoucherUrl: constancia,
      }, 'No se pudo registrar el pago en línea.');
    }

    const debido = totalAPagar(factura);
    if (pagado + TOLERANCIA_PESOS < debido) {
      this.logger.warn(`Factura ${facturaId}: Wompi cobró ${pagado} y se deben ${debido}; queda para verificación`);
      return { estado: 'por-verificar', facturaId, motivo: `Se pagaron $${pagado} de $${debido}.` };
    }

    await this.llamarAuthoriza('post', `/api/invoices/${facturaId}/confirm-payment`, {}, 'No se pudo confirmar el pago en línea.');
    this.logger.log(`Factura ${facturaId} pagada en línea (Wompi ${tx.id}, ${pagado})`);
    return { estado: 'pagada', facturaId };
  }

  private async facturaAuthoriza(id: number): Promise<any> {
    return this.llamarAuthoriza('get', `/api/invoices/${id}`, undefined, 'No se pudo consultar la factura.');
  }

  private async llamarAuthoriza(metodo: 'get' | 'post', ruta: string, cuerpo: any, respaldo: string): Promise<any> {
    try {
      const headers = authorizaInternalHeaders({ 'Content-Type': 'application/json' });
      const r = metodo === 'get'
        ? await firstValueFrom(this.http.get(`${this.authorizaUrl}${ruta}`, { headers }))
        : await firstValueFrom(this.http.post(`${this.authorizaUrl}${ruta}`, cuerpo, { headers }));
      return r.data;
    } catch (error) {
      this.logger.error(`Authoriza ${metodo.toUpperCase()} ${ruta}: ${error.response?.status} ${error.message}`);
      throw errorDeAuthoriza(error, respaldo);
    }
  }
}
