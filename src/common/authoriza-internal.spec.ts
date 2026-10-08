import { ExecutionContext } from '@nestjs/common';
import { authorizaInternalHeaders, billingScope } from './authoriza-internal';
import { AdminFactonetGuard } from '../auth/guards/admin-factonet.guard';

describe('billingScope (qué facturación ve cada rol)', () => {
  it('el administrador de FactoNet ve todo', () => {
    expect(billingScope('adminFactonet', 't1')).toEqual({ all: true });
  });

  it('el cliente solo ve su tenant', () => {
    expect(billingScope('adminInvoices', 't1')).toEqual({ tenantId: 't1' });
  });

  it('cliente sin tenant, otro rol o sin rol: 403', () => {
    expect(() => billingScope('adminInvoices')).toThrow('No tienes acceso');
    expect(() => billingScope('adminInout', 't1')).toThrow('No tienes acceso');
    expect(() => billingScope(undefined, 't1')).toThrow('No tienes acceso');
  });
});

describe('authorizaInternalHeaders', () => {
  it('lleva la clave interna y conserva las cabeceras extra', () => {
    process.env.INTERNAL_API_KEY = 'clave-de-prueba-123456';
    expect(authorizaInternalHeaders({ 'Content-Type': 'application/json' }))
      .toEqual({ 'x-internal-key': 'clave-de-prueba-123456', 'Content-Type': 'application/json' });
  });
});

describe('AdminFactonetGuard', () => {
  const ctx = (rol?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ user: rol ? { rol } : undefined }) }) }) as unknown as ExecutionContext;
  const guard = new AdminFactonetGuard();

  it('deja pasar al administrador de FactoNet', () => {
    expect(guard.canActivate(ctx('adminFactonet'))).toBe(true);
  });

  it('bloquea al cliente y a quien no tiene sesión', () => {
    expect(() => guard.canActivate(ctx('adminInvoices'))).toThrow('Solo el administrador');
    expect(() => guard.canActivate(ctx())).toThrow('Solo el administrador');
  });
});
