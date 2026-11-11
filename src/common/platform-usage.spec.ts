import { flushPlatformUsage, reportPlatformUsage } from './platform-usage';

describe('Consumo de plataformas reportado a Authoriza (indicadores de costos)', () => {
  const realFetch = global.fetch;
  const env = { ...process.env };
  afterEach(() => { global.fetch = realFetch; process.env = { ...env }; });

  it('acumula los correos recibidos por SES por cliente y los envía en lote como FactoNet', async () => {
    Object.assign(process.env, { INTERNAL_API_KEY: 'k', AUTHORIZA_API_URL: 'http://authoriza:3000' });
    const calls: any[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => { calls.push({ url, init }); return { ok: true } as any; }) as any;
    reportPlatformUsage({ platform: 'SES', metric: 'emails', quantity: 1, tenantId: 'tenant-cyclonet' });
    reportPlatformUsage({ platform: 'SES', metric: 'emails', quantity: 1, tenantId: 'tenant-cyclonet' });
    reportPlatformUsage({ platform: 'SES', metric: 'emails', quantity: 1, tenantId: null });
    await flushPlatformUsage();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://authoriza:3000/api/platform-costs/usage');
    expect(calls[0].init.headers['x-internal-key']).toBe('k');
    const { events } = JSON.parse(calls[0].init.body);
    expect(events.map((e: any) => [e.application, e.tenantId || '-', e.platform, e.metric, e.quantity]).sort()).toEqual([
      ['FactoNet', '-', 'SES', 'emails', 1],
      ['FactoNet', 'tenant-cyclonet', 'SES', 'emails', 2],
    ]);
  });

  it('sin INTERNAL_API_KEY no reporta nada', async () => {
    delete process.env.INTERNAL_API_KEY;
    global.fetch = jest.fn() as any;
    reportPlatformUsage({ platform: 'SES', metric: 'emails', quantity: 1 });
    await flushPlatformUsage();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
