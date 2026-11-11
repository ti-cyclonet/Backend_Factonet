import { limitsFromAuthoriza } from './plan.service';
import { aliasFromName } from './accounting.service';

describe('Planes de FactoNet para empresas', () => {
  it('lee los límites y funciones de FactoNet de la respuesta de Authoriza', () => {
    const body = {
      packageName: 'FACTONET INICIA',
      limits: [
        { variableName: 'nComprobantes', maxValue: 150, targetApplication: 'FactoNet', limitType: 'quantity' },
        { variableName: 'nFacturasRecibidas', maxValue: 30, targetApplication: 'FactoNet', limitType: 'quantity' },
        { variableName: 'fLecturaIA', maxValue: 0, targetApplication: 'FactoNet', limitType: 'feature' },
        { variableName: 'fBuzon', maxValue: 1, targetApplication: 'FactoNet', limitType: 'feature' },
        { variableName: 'nVentas', maxValue: 100, targetApplication: 'Inout', limitType: 'quantity' },
      ],
    };
    expect(limitsFromAuthoriza(body)).toEqual({
      active: true, packageName: 'FACTONET INICIA', vouchers: 150, received: 30, features: { fLecturaIA: false, fBuzon: true },
    });
  });

  it('999999 es ilimitado', () => {
    const l = limitsFromAuthoriza({ limits: [{ variableName: 'nComprobantes', maxValue: 999999, targetApplication: 'FactoNet', limitType: 'quantity' }] });
    expect(l.vouchers).toBeNull();
    expect(l.received).toBeNull();
  });

  it('alias del buzón a partir de la razón social', () => {
    expect(aliasFromName('Tienda La Esquiña S.A.S.')).toBe('tienda-la-esquina');
    expect(aliasFromName('Panadería Ñapa Ltda')).toBe('panaderia-napa');
    expect(aliasFromName('   ')).toBe('empresa');
    expect(aliasFromName('Distribuciones del Caribe Colombiano Internacional SAS').length).toBeLessThanOrEqual(30);
  });
});
