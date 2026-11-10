import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Contabilidad de FactoNet (base de datos propia de FactoNet). Todo lleva
 * companyId: hoy solo existe la empresa CycloNet, pero el modelo ya sirve
 * para varias empresas (FactoNet como SaaS).
 */

@Entity('acc_companies')
export class AccCompany {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Usuario principal de Authoriza dueño de la empresa. */
  @Column({ type: 'varchar', length: 100, unique: true })
  tenantId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  nit: string | null;

  /** Cuentas de los asientos automáticos (ver puc.ts › AccountMap). */
  @Column({ type: 'jsonb', nullable: true })
  accountMap: Record<string, string> | null;

  /** Primera fecha que se contabiliza automáticamente (no se reprocesa lo anterior). */
  @Column({ type: 'date', nullable: true })
  autoFrom: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('acc_accounts')
@Index(['companyId', 'code'], { unique: true })
export class AccAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 12 })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 8 })
  nature: 'DEBITO' | 'CREDITO';

  @Column({ type: 'smallint' })
  level: number;

  @Column({ type: 'varchar', length: 12, nullable: true })
  parentCode: string | null;

  @Column({ type: 'boolean', default: false })
  acceptsEntries: boolean;

  @Column({ type: 'boolean', default: false })
  requiresThirdParty: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}

@Entity('acc_third_parties')
@Index(['companyId', 'idNumber'], { unique: true })
export class AccThirdParty {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  /** Códigos DIAN: 13 cédula, 31 NIT… */
  @Column({ type: 'varchar', length: 3, default: '13' })
  idType: string;

  @Column({ type: 'varchar', length: 30 })
  idNumber: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  /** Usuario de Authoriza (clientes de CycloNet), para los asientos automáticos. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  authorizaUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/**
 * Comprobante contable (partida doble). BORRADOR se puede editar; CONTABILIZADO
 * es definitivo (para corregir se reversa con otro comprobante); ANULADO es un
 * contabilizado que se reversó.
 */
@Entity('acc_vouchers')
@Index(['companyId', 'date'])
@Index(['companyId', 'sourceKey'], { unique: true, where: '"sourceKey" IS NOT NULL' })
export class AccVoucher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  /** CI ingreso · CE egreso · NC nota contable · AUT automático. */
  @Column({ type: 'varchar', length: 4 })
  type: 'CI' | 'CE' | 'NC' | 'AUT';

  /** Consecutivo por empresa y tipo. */
  @Column({ type: 'integer' })
  number: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 300 })
  description: string;

  @Column({ type: 'varchar', length: 15, default: 'BORRADOR' })
  status: 'BORRADOR' | 'CONTABILIZADO' | 'ANULADO';

  /** Origen de un asiento automático (evita contabilizar dos veces lo mismo). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceKey: string | null;

  /** Comprobante que reversa a este (o al que reversa). */
  @Column({ type: 'uuid', nullable: true })
  reversalOfId: string | null;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0 })
  total: number;

  @Column({ type: 'varchar', length: 255 })
  createdBy: string;

  @Column({ type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  @OneToMany(() => AccVoucherLine, (l) => l.voucher, { cascade: true })
  lines: AccVoucherLine[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('acc_voucher_lines')
@Index(['companyId', 'accountCode'])
export class AccVoucherLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  voucherId: string;

  @ManyToOne(() => AccVoucher, (v) => v.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'voucherId' })
  voucher: AccVoucher;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 12 })
  accountCode: string;

  @Column({ type: 'uuid', nullable: true })
  thirdPartyId: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0 })
  debit: number;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0 })
  credit: number;
}

/** Mes contable (YYYY-MM). CERRADO no admite comprobantes con fecha en ese mes. */
@Entity('acc_periods')
@Index(['companyId', 'month'], { unique: true })
export class AccPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 7 })
  month: string;

  @Column({ type: 'varchar', length: 10, default: 'ABIERTO' })
  status: 'ABIERTO' | 'CERRADO';

  @Column({ type: 'varchar', length: 255, nullable: true })
  closedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}

export const ACCOUNTING_ENTITIES = [AccCompany, AccAccount, AccThirdParty, AccVoucher, AccVoucherLine, AccPeriod];
