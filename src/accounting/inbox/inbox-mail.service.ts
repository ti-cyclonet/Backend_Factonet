import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { ImapFlow } from 'imapflow';
import { InboxService } from './inbox.service';

/**
 * Buzón de facturas de proveedores. Dos formas de recibir los correos:
 *
 * 1. IMAP (INBOX_IMAP_HOST/USER/PASSWORD): FactoNet lee el buzón de correo
 *    (p. ej. facturas@cyclonet.com.co en Titan). Cada correo de la bandeja de
 *    entrada se procesa y se mueve a la carpeta INBOX_IMAP_DONE ("FactoNet").
 *    Si no se pudo leer, se mueve a "<carpeta>-Errores".
 * 2. S3 (INBOX_S3_BUCKET): AWS SES recibe los correos de un subdominio y los
 *    guarda en S3; se procesa el prefijo INBOX_S3_PREFIX y se mueve a
 *    procesados/ (o errores/).
 *
 * Se revisa cada INBOX_POLL_MINUTES.
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
  get imapHost(): string { return (process.env.INBOX_IMAP_HOST || '').trim(); }
  get imapConfigured(): boolean { return !!(this.imapHost && process.env.INBOX_IMAP_USER && process.env.INBOX_IMAP_PASSWORD); }
  get configured(): boolean { return this.imapConfigured || !!this.bucket; }

  onModuleInit(): void {
    if (!this.configured || process.env.NODE_ENV === 'test') return;
    const minutes = Math.max(1, Number(process.env.INBOX_POLL_MINUTES) || 5);
    this.timer = setInterval(() => this.poll().catch((e) => this.logger.warn(`Buzón: ${e.message}`)), minutes * 60_000);
    setTimeout(() => this.poll().catch((e) => this.logger.warn(`Buzón: ${e.message}`)), 30_000);
    this.logger.log(`Buzón de facturas: ${this.imapConfigured ? `IMAP ${process.env.INBOX_IMAP_USER}@${this.imapHost}` : `s3://${this.bucket}/${this.prefix}`} cada ${minutes} min`);
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
    try {
      const r = this.imapConfigured ? await this.pollImap() : await this.pollS3();
      if (r.emails) this.logger.log(`Buzón: ${r.emails} correo(s), ${r.documents} documento(s)`);
      return { configured: true, ...r };
    } finally {
      this.running = false;
    }
  }

  /** Lee la bandeja de entrada por IMAP y mueve cada correo procesado a la carpeta de FactoNet. */
  private async pollImap(): Promise<{ emails: number; documents: number }> {
    const done = (process.env.INBOX_IMAP_DONE || 'FactoNet').trim();
    const failed = `${done}-Errores`;
    const client = new ImapFlow({
      host: this.imapHost,
      port: Number(process.env.INBOX_IMAP_PORT) || 993,
      secure: process.env.INBOX_IMAP_SECURE !== 'false',
      auth: { user: process.env.INBOX_IMAP_USER!, pass: process.env.INBOX_IMAP_PASSWORD! },
      logger: false,
    });
    let emails = 0;
    let documents = 0;
    await client.connect();
    try {
      for (const box of [done, failed]) {
        try { await client.mailboxCreate(box); } catch { /* ya existe */ }
      }
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = (await client.search({ all: true }, { uid: true })) || [];
        for (const uid of uids.slice(0, 50)) {
          let target = done;
          try {
            const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
            if (!msg || !msg.source) continue;
            const results = await this.inbox.ingestRawEmail(msg.source);
            documents += results.length;
            emails += 1;
          } catch (e: any) {
            this.logger.warn(`Buzón IMAP: no se pudo procesar el correo ${uid}: ${e.message}`);
            target = failed;
          }
          await client.messageMove(String(uid), target, { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return { emails, documents };
  }

  /** Lee los correos que SES guardó en S3. */
  private async pollS3(): Promise<{ emails: number; documents: number }> {
    let emails = 0;
    let documents = 0;
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
    return { emails, documents };
  }

  private async move(key: string, folder: string): Promise<void> {
    const name = key.slice(this.prefix.length) || key;
    await this.s3().send(new CopyObjectCommand({ Bucket: this.bucket, CopySource: `${this.bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`, Key: `${folder}${name}` }));
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
