import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { InvoicesModule } from '../invoices/invoices.module';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';

/** Pago en línea con Wompi. Apagado por defecto: ver pasarela.config.ts. */
@Module({
  imports: [HttpModule, InvoicesModule],
  controllers: [PagosController],
  providers: [PagosService],
})
export class PagosModule {}
