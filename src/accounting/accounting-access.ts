import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Scope } from './accounting.service';

/** Roles con acceso a la contabilidad. */
export const ACCOUNTING_ROLES = ['adminFactonet', 'empresaFactonet', 'contadorFactonet'];

/**
 * Contabilidad: el administrador de FactoNet (la de CycloNet), la empresa que
 * contrató FactoNet y su contador invitado (la de esa empresa).
 */
@Injectable()
export class AccountingAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!ACCOUNTING_ROLES.includes(user?.rol)) throw new ForbiddenException('No tienes acceso a la contabilidad de FactoNet.');
    if (user.rol !== 'adminFactonet' && !user.tenantId) throw new ForbiddenException('Tu sesión no tiene una empresa asociada.');
    return true;
  }
}

/** Empresa de la sesión: ninguna (CycloNet) para el administrador; la del tenant para los demás. */
export function scopeOf(req: any): Scope | undefined {
  const user = req?.user;
  return user?.rol === 'adminFactonet' ? undefined : { tenantId: String(user?.tenantId) };
}

/** Solo el administrador de FactoNet (operaciones de CycloNet, p. ej. sincronizar con Authoriza). */
export function assertAdmin(req: any): void {
  if (req?.user?.rol !== 'adminFactonet') throw new ForbiddenException('Solo el administrador de FactoNet puede hacer esto.');
}

/** Solo quien administra la empresa (no el contador invitado). */
export function assertCompanyOwner(req: any): void {
  if (!['adminFactonet', 'empresaFactonet'].includes(req?.user?.rol)) throw new ForbiddenException('Solo la empresa puede cambiar sus datos.');
}
