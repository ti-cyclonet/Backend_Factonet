import { BadRequestException, Body, Controller, Get, Param, Post, Query, Request, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminFactonetGuard } from '../../auth/guards/admin-factonet.guard';
import { InboxService } from './inbox.service';
import { InboxMailService } from './inbox-mail.service';

/** Facturas recibidas de proveedores (contabilidad de CycloNet, solo adminFactonet). */
@Controller('accounting/inbox')
@UseGuards(JwtAuthGuard, AdminFactonetGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService, private readonly mail: InboxMailService) {}

  @Get('config')
  config() {
    return { address: this.inbox.address(), mailbox: this.mail.configured };
  }

  @Get()
  list(@Query('status') status?: string) { return this.inbox.list(status); }

  @Get('rules')
  rules() { return this.inbox.rulesList(); }

  /** Revisa el buzón ya (también corre solo cada pocos minutos). */
  @Post('poll')
  poll() { return this.mail.poll(); }

  /** Carga a mano: ZIP del proveedor, XML o PDF (hasta 10 archivos de 10 MB). */
  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@UploadedFiles() files: Array<{ originalname: string; buffer: Buffer }>, @Request() req: any) {
    if (!files?.length) throw new BadRequestException('Adjunta el ZIP, XML o PDF de la factura.');
    return this.inbox.ingestFiles(files.map((f) => ({ name: f.originalname, data: f.buffer })), { source: 'CARGA', from: req.user?.email || null });
  }

  @Get(':id')
  get(@Param('id') id: string) { return this.inbox.get(id); }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const f = await this.inbox.pdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.name.replace(/[^\w.\-]/g, '_')}"`, 'Content-Length': String(f.data.length) });
    res.send(f.data);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() b: { accountCode: string; saveRule?: boolean; date?: string }, @Request() req: any) {
    return this.inbox.approve(id, b || ({} as any), req.user?.email || 'admin');
  }

  @Post(':id/discard')
  discard(@Param('id') id: string, @Body() b: { reason?: string }, @Request() req: any) {
    return this.inbox.discard(id, b?.reason, req.user?.email || 'admin');
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string) { return this.inbox.reopen(id); }
}
