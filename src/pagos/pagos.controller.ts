import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PagosService } from './pagos.service';
import { EventoWompi } from './wompi';

@Controller('pagos')
export class PagosController {
  constructor(private readonly pagos: PagosService) {}

  /** ¿Se ofrece "Pagar en línea"? Mientras no haya cuenta en Wompi, false. */
  @Get('configuracion')
  @UseGuards(JwtAuthGuard)
  configuracion() {
    return this.pagos.configuracionPublica();
  }

  /** URL de Wompi para pagar una factura del cliente. */
  @Post('facturas/:id/checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.pagos.crearCheckout(id, req.user);
  }

  /** Al volver de Wompi: consulta la transacción y la aplica si no lo hizo el evento. */
  @Get('wompi/transacciones/:id')
  @UseGuards(JwtAuthGuard)
  verificar(@Param('id') id: string, @Request() req) {
    return this.pagos.verificarTransaccion(id, req.user);
  }

  /**
   * Eventos de Wompi. Pública (Wompi no manda JWT): la autenticidad la da la
   * firma del evento, que se verifica con el secreto de eventos.
   */
  @Post('wompi/eventos')
  @HttpCode(200)
  eventos(@Body() evento: EventoWompi) {
    return this.pagos.procesarEvento(evento);
  }
}
