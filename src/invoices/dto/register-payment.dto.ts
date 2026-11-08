import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsPositive, IsString, Matches, MaxLength } from 'class-validator';

/** Campos del formulario multipart con que el cliente reporta un pago. */
export class RegisterPaymentDto {
  @IsDateString({}, { message: 'La fecha de pago no es válida.' })
  paymentDate: string;

  // Llega como texto en el multipart
  @Type(() => Number)
  @IsNumber({}, { message: 'El valor pagado debe ser un número.' })
  @IsPositive({ message: 'El valor pagado debe ser mayor que cero.' })
  paidAmount: number;

  // Referencia del soporte (la lee el OCR o la escribe el cliente): Authoriza
  // rechaza con 409 la que ya se usó en el pago de otra factura
  @IsString({ message: 'Escribe el número de referencia del comprobante.' })
  @MaxLength(100, { message: 'La referencia es demasiado larga.' })
  @Matches(/(?:[A-Za-z0-9].*){4}/, { message: 'Escribe el número de referencia del comprobante.' })
  paymentReference: string;
}
