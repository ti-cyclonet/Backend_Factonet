import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsPositive } from 'class-validator';

/** Campos del formulario multipart con que el cliente reporta un pago. */
export class RegisterPaymentDto {
  @IsDateString({}, { message: 'La fecha de pago no es válida.' })
  paymentDate: string;

  // Llega como texto en el multipart
  @Type(() => Number)
  @IsNumber({}, { message: 'El valor pagado debe ser un número.' })
  @IsPositive({ message: 'El valor pagado debe ser mayor que cero.' })
  paidAmount: number;
}
