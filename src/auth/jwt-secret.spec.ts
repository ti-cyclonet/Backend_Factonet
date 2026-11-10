import { getJwtSecret } from './jwt-secret';

describe('getJwtSecret', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('falla si no hay JWT_SECRET ni AUTHORIZA_JWT_SECRET', () => {
    delete process.env.JWT_SECRET;
    delete process.env.AUTHORIZA_JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET no está configurado/);
  });

  it('falla si el valor está vacío', () => {
    process.env.JWT_SECRET = '   ';
    delete process.env.AUTHORIZA_JWT_SECRET;
    expect(() => getJwtSecret()).toThrow();
  });

  it('usa JWT_SECRET y, si falta, AUTHORIZA_JWT_SECRET', () => {
    process.env.JWT_SECRET = 'secreto-de-prueba';
    expect(getJwtSecret()).toBe('secreto-de-prueba');
    delete process.env.JWT_SECRET;
    process.env.AUTHORIZA_JWT_SECRET = 'otro-secreto-de-prueba';
    expect(getJwtSecret()).toBe('otro-secreto-de-prueba');
  });
});
