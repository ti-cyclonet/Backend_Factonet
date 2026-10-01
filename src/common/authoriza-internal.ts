import { ForbiddenException } from '@nestjs/common';

/**
 * Cabeceras para llamar a Authoriza de servicio a servicio. Las rutas de
 * facturas de Authoriza ya no son públicas: exigen la `x-internal-key`
 * (INTERNAL_API_KEY, la misma en todos los contenedores del ecosistema).
 */
export function authorizaInternalHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-internal-key': process.env.INTERNAL_API_KEY || '', ...extra };
}

/**
 * Qué facturación puede ver cada rol: el administrador de FactoNet ve todo, el
 * cliente (adminInvoices) solo la de su tenant y cualquier otro rol nada.
 * Antes todo lo que no fuera adminInvoices se trataba como administrador.
 */
export function billingScope(rol?: string, tenantId?: string): { all: true } | { tenantId: string } {
  if (rol === 'adminFactonet') return { all: true };
  if (rol === 'adminInvoices' && tenantId) return { tenantId };
  throw new ForbiddenException('No tienes acceso a la facturación de FactoNet.');
}
