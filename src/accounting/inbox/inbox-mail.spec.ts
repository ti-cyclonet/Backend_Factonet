const moves: [string, string][] = [];
const created: string[] = [];
jest.mock('imapflow', () => ({
  ImapFlow: jest.fn().mockImplementation(() => ({
    connect: jest.fn(async () => undefined),
    logout: jest.fn(async () => undefined),
    mailboxCreate: jest.fn(async (b: string) => { created.push(b); }),
    getMailboxLock: jest.fn(async () => ({ release: jest.fn() })),
    search: jest.fn(async () => [11, 12]),
    fetchOne: jest.fn(async (uid: string) => ({ source: Buffer.from(`correo ${uid}`) })),
    messageMove: jest.fn(async (uid: string, box: string) => { moves.push([uid, box]); }),
  })),
}));

import { InboxMailService } from './inbox-mail.service';

describe('Buzón de facturas por IMAP (facturas@cyclonet.com.co)', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; moves.length = 0; created.length = 0; });

  it('sin configuración no revisa nada', async () => {
    delete process.env.INBOX_IMAP_HOST; delete process.env.INBOX_S3_BUCKET;
    const svc = new InboxMailService({ ingestRawEmail: jest.fn() } as any);
    expect(await svc.poll()).toEqual({ configured: false, emails: 0, documents: 0 });
  });

  it('procesa cada correo de la bandeja y lo mueve a FactoNet (o a FactoNet-Errores si falla)', async () => {
    Object.assign(process.env, { INBOX_IMAP_HOST: 'imap.titan.email', INBOX_IMAP_USER: 'facturas@cyclonet.com.co', INBOX_IMAP_PASSWORD: 'x' });
    const ingestRawEmail = jest.fn(async (raw: Buffer) => {
      if (raw.toString().endsWith('12')) throw new Error('correo dañado');
      return [{ id: 'd1' }];
    });
    const svc = new InboxMailService({ ingestRawEmail } as any);
    expect(await svc.poll()).toEqual({ configured: true, emails: 1, documents: 1 });
    expect(created).toEqual(['FactoNet', 'FactoNet-Errores']);
    expect(moves).toEqual([['11', 'FactoNet'], ['12', 'FactoNet-Errores']]);
  });
});
