import { ConfigWompi, EntornoWompi } from './wompi';

/**
 * Configuración de la pasarela de pago, leída de variables de entorno.
 *
 * La pasarela queda APAGADA salvo que PASARELA_ACTIVA=true y estén todas las
 * llaves de Wompi. Apagada, el portal solo ofrece "Reportar pago" (constancia
 * + verificación del administrador), que es el flujo actual.
 *
 *   PASARELA_ACTIVA=true
 *   WOMPI_ENTORNO=sandbox | produccion
 *   WOMPI_LLAVE_PUBLICA=pub_test_...      (Wompi > Desarrolladores)
 *   WOMPI_SECRETO_INTEGRIDAD=test_integrity_...
 *   WOMPI_SECRETO_EVENTOS=test_events_...
 *   FACTONET_URL_PORTAL=https://factonet.cyclonet.com.co   (a donde vuelve el cliente)
 *
 * En Wompi > Desarrolladores, la URL de eventos es
 *   https://api.cyclonet.com.co/api/billing/pagos/wompi/eventos
 * (nginx enruta /api/billing/ a FactoNet).
 */
export interface ConfigPasarela {
  activa: boolean;
  /** Qué falta para poder activarla (vacío si está completa). */
  faltantes: string[];
  wompi: ConfigWompi;
  urlPortal: string;
}

export function leerConfigPasarela(env: NodeJS.ProcessEnv = process.env): ConfigPasarela {
  const wompi: ConfigWompi = {
    llavePublica: (env.WOMPI_LLAVE_PUBLICA || '').trim(),
    secretoIntegridad: (env.WOMPI_SECRETO_INTEGRIDAD || '').trim(),
    secretoEventos: (env.WOMPI_SECRETO_EVENTOS || '').trim(),
    entorno: (env.WOMPI_ENTORNO || '').trim().toLowerCase() === 'produccion' ? 'produccion' : ('sandbox' as EntornoWompi),
  };
  const urlPortal = (env.FACTONET_URL_PORTAL || '').trim().replace(/\/+$/, '');
  const faltantes = [
    ['WOMPI_LLAVE_PUBLICA', wompi.llavePublica],
    ['WOMPI_SECRETO_INTEGRIDAD', wompi.secretoIntegridad],
    ['WOMPI_SECRETO_EVENTOS', wompi.secretoEventos],
    ['FACTONET_URL_PORTAL', urlPortal],
  ].filter(([, v]) => !v).map(([k]) => k);

  // Una llave de pruebas en producción (o al revés) cobraría en el ambiente equivocado
  const prefijo = wompi.entorno === 'produccion' ? 'pub_prod_' : 'pub_test_';
  if (wompi.llavePublica && !wompi.llavePublica.startsWith(prefijo)) faltantes.push(`WOMPI_LLAVE_PUBLICA debe empezar por ${prefijo}`);

  const encendida = (env.PASARELA_ACTIVA || '').trim().toLowerCase() === 'true';
  return { activa: encendida && faltantes.length === 0, faltantes, wompi, urlPortal };
}
