import { Controller, Get, Headers, Request, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Resumen del Dashboard (admin: todo el ecosistema; cliente: lo suyo). */
  @Get('overview')
  overview(@Request() req, @Headers('authorization') auth?: string) {
    return this.dashboardService.getOverview(req.user?.tenantId, req.user?.rol, auth);
  }

  /** Conteos para las notificaciones del encabezado. */
  @Get('metrics')
  metrics(@Request() req, @Headers('authorization') auth?: string) {
    return this.dashboardService.getMetrics(req.user?.tenantId, req.user?.rol, auth);
  }
}
