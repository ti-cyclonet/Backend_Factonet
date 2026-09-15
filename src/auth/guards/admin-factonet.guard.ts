import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * El modulo de configuracion (periodos, parametros globales) es exclusivo del
 * administrador de FactoNet. El resto de roles solo debe poder consultar el
 * periodo activo (ver PeriodsController.getActivePeriod, que no usa este guard).
 */
@Injectable()
export class AdminFactonetGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.user?.rol !== 'adminFactonet') {
      throw new ForbiddenException('Solo el administrador de FactoNet puede acceder a este módulo');
    }
    return true;
  }
}
