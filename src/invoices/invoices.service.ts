import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly authorizerUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.authorizerUrl = this.configService.get<string>('AUTH_SERVICE_URL', 'http://localhost:3000');
  }

  async findAll() {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.authorizerUrl}/api/invoices`)
      );
      
      return this.transformInvoices(response.data);
    } catch (error) {
      this.logger.error('Error fetching invoices from Authoriza:', error.message);
      return [];
    }
  }

  private transformInvoices(invoices: any[]) {
    return invoices.map(invoice => ({
      id: invoice.id,
      numero: `INV-${String(invoice.id).padStart(6, '0')}`,
      cliente: invoice.user?.basicData?.strName || invoice.user?.strUserName || 'Cliente desconocido',
      fechaEmision: invoice.issueDate,
      fechaVencimiento: invoice.expirationDate,
      total: Number(invoice.value),
      estado: this.mapStatus(invoice.status)
    }));
  }

  private mapStatus(status: string): 'Pagada' | 'Pendiente' | 'Vencida' {
    switch (status) {
      case 'Paid': return 'Pagada';
      case 'In arrears': return 'Vencida';
      default: return 'Pendiente';
    }
  }

  async sweepInvoices() {
    try {
      const url = `${this.authorizerUrl}/api/sweep/invoices`;
      this.logger.log(`Calling sweep endpoint: ${url}`);
      
      const response = await firstValueFrom(
        this.httpService.post(url)
      );
      
      return response.data;
    } catch (error) {
      this.logger.error(`Error executing invoice sweep to ${this.authorizerUrl}:`, error.response?.status, error.message);
      throw new Error('Failed to execute invoice sweep');
    }
  }
}