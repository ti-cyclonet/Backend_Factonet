/**
 * Plan Único de Cuentas (PUC, Decreto 2650 de 1993) base para una empresa de
 * servicios como CycloNet: clases, grupos y las cuentas/subcuentas que usan
 * los asientos automáticos y los comprobantes más comunes. Cada empresa puede
 * agregar las suyas. PENDIENTE: validar con el contador de CycloNet.
 */

export type Nature = 'DEBITO' | 'CREDITO';

export interface PucAccount {
  code: string;
  name: string;
  /** Solo las cuentas de último nivel (subcuentas) reciben movimientos. */
  acceptsEntries: boolean;
  /** Exige tercero en cada movimiento (cartera, proveedores, impuestos con NIT). */
  requiresThirdParty?: boolean;
}

/** Naturaleza según la clase: 1 activo, 5 gastos, 6 y 7 costos → débito; 2, 3 y 4 → crédito. */
export function natureOf(code: string): Nature {
  return ['1', '5', '6', '7'].includes(code[0]) ? 'DEBITO' : 'CREDITO';
}

/** Nivel PUC: 1 clase, 2 grupo, 4 cuenta, 6 subcuenta, 8+ auxiliar. */
export function levelOf(code: string): number {
  const n = code.length;
  return n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 3 : n <= 6 ? 4 : 5;
}

/** Código del padre (el siguiente nivel hacia arriba). */
export function parentOf(code: string): string | null {
  const n = code.length;
  if (n <= 1) return null;
  if (n === 2) return code.slice(0, 1);
  if (n <= 4) return code.slice(0, 2);
  if (n <= 6) return code.slice(0, 4);
  return code.slice(0, 6);
}

const A = (code: string, name: string, extra: Partial<PucAccount> = {}): PucAccount => ({ code, name, acceptsEntries: code.length >= 6, ...extra });

export const PUC_BASE: PucAccount[] = [
  // ── 1 Activo
  A('1', 'Activo'),
  A('11', 'Disponible'),
  A('1105', 'Caja'), A('110505', 'Caja general'),
  A('1110', 'Bancos'), A('111005', 'Moneda nacional'),
  A('13', 'Deudores'),
  A('1305', 'Clientes'), A('130505', 'Clientes nacionales', { requiresThirdParty: true }),
  A('1355', 'Anticipo de impuestos y contribuciones o saldos a favor'),
  A('135515', 'Retención en la fuente', { requiresThirdParty: true }),
  A('135517', 'Impuesto a las ventas retenido', { requiresThirdParty: true }),
  A('135518', 'Impuesto de industria y comercio retenido', { requiresThirdParty: true }),
  A('15', 'Propiedades, planta y equipo'),
  A('1528', 'Equipo de computación y comunicación'), A('152805', 'Equipos de procesamiento de datos'),
  A('1592', 'Depreciación acumulada'), A('159220', 'Equipo de computación y comunicación'),
  // ── 2 Pasivo
  A('2', 'Pasivo'),
  A('22', 'Proveedores'),
  A('2205', 'Nacionales'), A('220505', 'Proveedores nacionales', { requiresThirdParty: true }),
  A('23', 'Cuentas por pagar'),
  A('2335', 'Costos y gastos por pagar'), A('233595', 'Otros costos y gastos por pagar', { requiresThirdParty: true }),
  A('2365', 'Retención en la fuente'),
  A('236525', 'Servicios', { requiresThirdParty: true }), A('236540', 'Compras', { requiresThirdParty: true }),
  A('24', 'Impuestos, gravámenes y tasas'),
  A('2408', 'Impuesto sobre las ventas por pagar'),
  A('240805', 'IVA generado', { requiresThirdParty: false }), A('240810', 'IVA descontable'),
  A('2412', 'Impuesto de industria y comercio'), A('241205', 'Vigencia fiscal corriente'),
  A('28', 'Otros pasivos'),
  A('2805', 'Anticipos y avances recibidos'), A('280505', 'De clientes', { requiresThirdParty: true }),
  // ── 3 Patrimonio
  A('3', 'Patrimonio'),
  A('31', 'Capital social'), A('3105', 'Capital suscrito y pagado'), A('310505', 'Capital autorizado'),
  A('36', 'Resultados del ejercicio'), A('3605', 'Utilidad del ejercicio'), A('360505', 'Utilidad del ejercicio'),
  A('3610', 'Pérdida del ejercicio'), A('361005', 'Pérdida del ejercicio'),
  A('37', 'Resultados de ejercicios anteriores'), A('3705', 'Utilidades acumuladas'), A('370505', 'Utilidades acumuladas'),
  // ── 4 Ingresos
  A('4', 'Ingresos'),
  A('41', 'Operacionales'),
  A('4155', 'Actividades inmobiliarias, empresariales y de alquiler'),
  A('415595', 'Actividades conexas (servicios de software y plataformas)'),
  A('4175', 'Devoluciones en ventas (DB)'), A('417505', 'Devoluciones y descuentos en ventas'),
  A('42', 'No operacionales'),
  A('4210', 'Financieros'), A('421005', 'Intereses (mora de clientes)'), A('421040', 'Descuentos comerciales condicionados'),
  A('4250', 'Recuperaciones'), A('425050', 'Reintegro de otros costos y gastos'),
  // ── 5 Gastos
  A('5', 'Gastos'),
  A('51', 'Operacionales de administración'),
  A('5110', 'Honorarios'), A('511025', 'Asesoría jurídica'), A('511030', 'Asesoría financiera y contable'),
  A('5115', 'Impuestos'), A('511505', 'Industria y comercio'),
  A('5135', 'Servicios'), A('513525', 'Acueducto, energía, internet y telecomunicaciones'), A('513595', 'Otros servicios'),
  A('5145', 'Mantenimiento y reparaciones'), A('514525', 'Equipo de computación'),
  A('5160', 'Depreciaciones'), A('516020', 'Equipo de computación y comunicación'),
  A('52', 'Operacionales de ventas'),
  A('5235', 'Servicios'),
  A('523525', 'Plataformas en la nube (hosting, almacenamiento)'), A('523550', 'Publicidad y propaganda'),
  A('523595', 'Otros servicios de ventas'),
  A('53', 'No operacionales'),
  A('5305', 'Financieros'), A('530505', 'Gastos bancarios'), A('530515', 'Comisiones (pasarelas de pago)'),
  A('530520', 'Intereses'), A('530595', 'Gravamen a los movimientos financieros (4x1000)'),
];

/**
 * Cuentas que usan los asientos automáticos de las facturas de CycloNet.
 * Se pueden cambiar sin desplegar código (configuración de la empresa).
 */
export interface AccountMap {
  clientes: string;
  ingresos: string;
  ivaGenerado: string;
  bancos: string;
  interesesMora: string;
}

export const DEFAULT_ACCOUNT_MAP: AccountMap = {
  clientes: '130505',
  ingresos: '415595',
  ivaGenerado: '240805',
  bancos: '111005',
  interesesMora: '421005',
};
