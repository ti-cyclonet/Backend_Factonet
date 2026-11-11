import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { authorizaInternalHeaders } from '../common/authoriza-internal';

export interface PlanLimits {
  /** false = sin plan de FactoNet activo (p. ej. contrato aún sin firmar). */
  active: boolean;
  packageName: string | null;
  /** Comprobantes contables al mes (null = sin límite). */
  vouchers: number | null;
  /** Facturas de proveedores recibidas al mes (null = sin límite). */
  received: number | null;
  /** Funciones del plan (fLecturaIA, fCobranza, fConciliacion…). */
  features: Record<string, boolean>;
}

const UNLIMITED = 99999;
const CACHE_MS = 5 * 60_000;
const monthStart = () => `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()).slice(0, 7)}-01`;

/** Lee los límites de un paquete (respuesta de GET /contracts/tenant/:id/limits?application=FactoNet). */
export function limitsFromAuthoriza(body: any): PlanLimits {
  const vars: any[] = Array.isArray(body?.limits) ? body.limits : [];
  const fn = vars.filter((v) => String(v.targetApplication || '').toLowerCase() === 'factonet');
  const q = (name: string) => {
    const v = fn.find((x) => x.variableName === name);
    if (!v) return null;
    return Number(v.maxValue) >= UNLIMITED ? null : Number(v.maxValue);
  };
  const features: Record<string, boolean> = {};
  for (const v of fn.filter((x) => x.limitType === 'feature')) features[v.variableName] = Number(v.maxValue) >= 1;
  return { active: true, packageName: body?.packageName || null, vouchers: q('nComprobantes'), received: q('nFacturasRecibidas'), features };
}

/**
 * Plan de FactoNet de la empresa (Authoriza) y su consumo del mes. La empresa de
 * CycloNet (sin tenant) no tiene límites.
 */
@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);
  private readonly authorizaUrl = (process.env.AUTHORIZA_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  private readonly cache = new Map<string, { at: number; limits: PlanLimits }>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async limits(tenantId: string): Promise<PlanLimits> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.limits;
    let limits: PlanLimits;
    try {
      const res = await fetch(`${this.authorizaUrl}/api/contracts/tenant/${encodeURIComponent(tenantId)}/limits?application=FactoNet`, {
        headers: authorizaInternalHeaders(), signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) limits = { active: false, packageName: null, vouchers: 0, received: 0, features: {} };
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      else limits = limitsFromAuthoriza(await res.json());
    } catch (e: any) {
      // Authoriza caído: no bloquear a la empresa por eso; se reintenta en la siguiente consulta.
      this.logger.warn(`No se pudo consultar el plan de ${tenantId}: ${e.message}`);
      return hit?.limits || { active: true, packageName: null, vouchers: null, received: null, features: {} };
    }
    this.cache.set(tenantId, { at: Date.now(), limits });
    return limits;
  }

  /** Consumo del mes de una empresa: comprobantes (sin los automáticos) y facturas recibidas. */
  async usage(companyId: string): Promise<{ vouchers: number; received: number }> {
    const from = monthStart();
    const [[v], [r]] = await Promise.all([
      this.dataSource.query(`SELECT COUNT(*)::int AS n FROM acc_vouchers WHERE "companyId" = $1 AND type <> 'AUT' AND "createdAt" >= $2`, [companyId, from]),
      this.dataSource.query(`SELECT COUNT(*)::int AS n FROM acc_inbox_documents WHERE "companyId" = $1 AND status NOT IN ('DUPLICADA', 'AVISO', 'RECHAZADA') AND "receivedAt" >= $2`, [companyId, from]),
    ]);
    return { vouchers: Number(v?.n) || 0, received: Number(r?.n) || 0 };
  }

  /** La empresa necesita un plan activo para usar su contabilidad. */
  async assertActive(tenantId: string): Promise<PlanLimits> {
    const l = await this.limits(tenantId);
    if (!l.active) throw new ForbiddenException({ code: 'PLAN_INACTIVO', message: 'Tu plan de FactoNet no está activo. Firma tu contrato en Contratos para activarlo.' });
    return l;
  }

  /** Antes de crear un comprobante: ¿queda cupo en el mes? */
  async assertVoucherQuota(tenantId: string, companyId: string): Promise<void> {
    const l = await this.assertActive(tenantId);
    if (l.vouchers === null) return;
    const { vouchers } = await this.usage(companyId);
    if (vouchers >= l.vouchers) {
      throw new ForbiddenException({ code: 'LIMITE_COMPROBANTES', message: `Llegaste a los ${l.vouchers} comprobantes del mes de tu plan ${l.packageName || ''}. Cambia a un plan superior para seguir registrando este mes.`.replace('  ', ' ') });
    }
  }
}
