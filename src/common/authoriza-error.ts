import { BadGatewayException, HttpException } from '@nestjs/common';

/**
 * Convierte el error de una llamada a Authoriza en una respuesta HTTP con su
 * mensaje real. Antes se lanzaba `new Error(...)`, que NestJS convierte en un
 * 500 "Internal server error": el usuario nunca veía por qué falló (constancia
 * faltante, factura ya pagada, etc.).
 *
 * - Authoriza respondió 4xx: se conserva el código y su mensaje. Salvo 401:
 *   es la clave interna entre servicios, no la sesión del usuario, y un 401
 *   haría que el frontend lo sacara de la sesión.
 * - Authoriza respondió 5xx o no respondió: 502 con el mensaje de respaldo.
 * - Ya era un HttpException (validación propia): se deja pasar tal cual.
 */
export function errorDeAuthoriza(error: any, respaldo: string): HttpException {
  if (error instanceof HttpException) return error;

  const status: number | undefined = error?.response?.status;
  const data = error?.response?.data;
  const crudo = data?.message ?? data?.error;
  const mensaje = Array.isArray(crudo) ? crudo.join('. ') : typeof crudo === 'string' && crudo.trim() ? crudo : null;

  if (status && status >= 400 && status < 500 && status !== 401) {
    return new HttpException({ statusCode: status, message: mensaje || respaldo }, status);
  }
  return new BadGatewayException(respaldo);
}
