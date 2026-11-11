import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { InboxService } from './inbox.service';

/**
 * Buzón de facturas de proveedores.
 *
 * AWS SES recibe los correos del subdominio de facturas (p. ej.
 * cyclonet@facturas.cyclonet.com.co) y los guarda en S3 (INBOX_S3_BUCKET,
 * prefijo INBOX_S3_PREFIX). Este servicio revisa ese prefijo cada
 * INBOX_POLL_MINUTES, procesa cada correo y lo mueve a procesados/ (o a
 * errores/ si no se pudo leer). Credenciales: las del entorno o el rol de la
 * instancia (cadena estándar del SDK de AWS).
 */
@Injectable()
export class InboxMailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboxMailService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private client: S3Client | null = null;

  constructor(private readonly inbox: InboxService) {}

  get bucket(): string { return (process.env.INBOX_S3_BUCKET || '').trim(); }
  get prefix(): string { return (process.env.INBOX_S3_PREFIX || 'entrantes/').trim(); }
  get configured(): boolean { return !!this.bucket; }

  onModuleInit(): void {
    if (!this.configured || process.env.NODE_ENV === 'test') return;
    const minutes = Math.max(1, Number(process.env.INBOX_POLL_MINUTES) || 5);
    this.timer = setInterval(() => this.poll().catch((e) => this.logger.warn(`Buzón: ${e.message}`)), minutes * 60_000);
    setTimeout(() => this.poll().catch((e) => this.logger.warn(`Buzón: ${e.message}`)), 30_000);
    this.logger.log(`Buzón de facturas: s3://${this.bucket}/${this.prefix} cada ${minutes} min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private s3(): S3Client {
    if (!this.client) this.client = new S3Client({ region: process.env.INBOX_S3_REGION || process.env.AWS_REGION || 'us-east-1' });
    return this.client;
  }

  /** Procesa los correos nuevos. Devuelve cuántos correos y documentos se leyeron. */
  async poll(): Promise<{ configured: boolean; emails: number; documents: number }> {
    if (!this.configured) return { configured: false, emails: 0, documents: 0 };
    if (this.running) return { configured: true, emails: 0, documents: 0 };
    this.running = true;
    let emails = 0;
    let documents = 0;
    try {
      const listed = await this.s3().send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix, MaxKeys: 50 }));
      for (const obj of listed.Contents || []) {
        const key = obj.Key!;
        if (key.endsWith('/') || key.endsWith('AMAZON_SES_SETUP_NOTIFICATION')) {
          if (key.endsWith('AMAZON_SES_SETUP_NOTIFICATION')) await this.move(key, 'procesados/');
          continue;
        }
        try {
          const got = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
          const raw = Buffer.from(await got.Body!.transformToByteArray());
          const results = await this.inbox.ingestRawEmail(raw);
          documents += results.length;
          emails += 1;
          await this.move(key, 'procesados/');
        } catch (e: any) {
          this.logger.warn(`Buzón: no se pudo procesar ${key}: ${e.message}`);
          await this.move(key, 'errores/').catch(() => undefined);
        }
      }
    } finally {
      this.running = false;
    }
    if (emails) this.logger.log(`Buzón: ${emails} correo(s), ${documents} documento(s)`);
    return { configured: true, emails, documents };
  }

  private async move(key: string, folder: string): Promise<void> {
    const name = key.slice(this.prefix.length) || key;
    await this.s3().send(new CopyObjectCommand({ Bucket: this.bucket, CopySource: `${this.bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`, Key: `${folder}${name}` }));
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
