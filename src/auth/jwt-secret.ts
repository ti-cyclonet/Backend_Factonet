/**
 * Secreto con el que Authoriza firma los JWT del ecosistema. Se lee del
 * entorno: antes estaba escrito en jwt.strategy.ts y cualquiera con acceso al
 * repositorio podía fabricar tokens válidos.
 *
 * FactoNet recibe JWT_SECRET (y AUTHORIZA_JWT_SECRET) en
 * deploy/docker-compose.prod.yml; ambos deben tener el mismo valor que
 * JWT_SECRET en Authoriza. Sin ninguno de los dos el backend no arranca:
 * nunca se valida con un valor por defecto.
 */
export function getJwtSecret(): string {
  const secret = (process.env.JWT_SECRET || process.env.AUTHORIZA_JWT_SECRET)?.trim();
  if (!secret) {
    throw new Error(
      'JWT_SECRET no está configurado. Defínelo en el entorno (deploy/.env.production o .env local) ' +
        'con el mismo valor que usa Authoriza para firmar los tokens.',
    );
  }
  return secret;
}
