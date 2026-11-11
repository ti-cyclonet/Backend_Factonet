import { BadRequestException, Body, Controller, Get, Param, Post, Query, Request, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AccountingAccessGuard, assertAdmin, scopeOf } from '../accounting-access';
import { AccountingService, Scope } from '../accounting.service';
import { PlanService } from '../plan.service';
import { InboxService } from './inbox.service';
import { InboxMailService } from './inbox-mail.service';

/**
 * Facturas recibidas de proveedores: las de CycloNet (administrador de FactoNet)
 * o las de la empresa de la sesión (empresaFactonet, contadorFactonet).
 */
@Controller('accounting/inbox')
@UseGuards(JwtAuthGuard, AccountingAccessGuard)
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly mail: InboxMailService,
    private readonly plans: PlanService,
    private readonly acc: AccountingService,
  ) {}

  /** Empresa de la sesión con su plan activo (la de CycloNet no tiene plan). */
  private async scope(req: any): Promise<Scope | undefined> {
    const s = scopeOf(req);
    if (s) await this.plans.assertActive(s.tenantId);
    return s;
  }

  private user(req: any): string {
    return req.user?.email || req.user?.username || 'usuario';
  }

  @Get('config')
  async config(@Request() req: any) {
    return { address: await this.inbox.address(await this.scope(req)), mailbox: this.mail.configured, canPoll: req.user?.rol === 'adminFactonet' };
  }

  @Get()
  async list(@Query('status') status: string, @Request() req: any) { return this.inbox.list(status, await this.scope(req)); }

  @Get('rules')
  async rules(@Request() req: any) { return this.inbox.rulesList(await this.scope(req)); }

  /** Revisa el buzón ya (también corre solo cada pocos minutos). Es uno solo para todas las empresas. */
  @Post('poll')
  poll(@Request() req: any) {
    assertAdmin(req);
    return this.mail.poll();
  }

  /** Carga a mano: ZIP del proveedor, XML o PDF (hasta 10 archivos de 10 MB). */
  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@UploadedFiles() files: Array<{ originalname: string; buffer: Buffer }>, @Request() req: any) {
    if (!files?.length) throw new BadRequestException('Adjunta el ZIP, XML o PDF de la factura.');
    const s = await this.scope(req);
    return this.inbox.ingestFiles(files.map((f) => ({ name: f.originalname, data: f.buffer })), { source: 'CARGA', from: req.user?.email || null }, null, s);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Request() req: any) { return this.inbox.get(id, await this.scope(req)); }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const f = await this.inbox.pdf(id, await this.scope(req));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.name.replace(/[^\w.\-]/g, '_')}"`, 'Content-Length': String(f.data.length) });
    res.send(f.data);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() b: { accountCode: string; saveRule?: boolean; date?: string }, @Request() req: any) {
    const s = await this.scope(req);
    if (s) await this.plans.assertVoucherQuota(s.tenantId, (await this.acc.company(s)).id);
    return this.inbox.approve(id, b || ({} as any), this.user(req), s);
  }

  @Post(':id/discard')
  async discard(@Param('id') id: string, @Body() b: { reason?: string }, @Request() req: any) {
    return this.inbox.discard(id, b?.reason, this.user(req), await this.scope(req));
  }

  @Post(':id/reopen')
  async reopen(@Param('id') id: string, @Request() req: any) { return this.inbox.reopen(id, await this.scope(req)); }
}
