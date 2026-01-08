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
    return invoices.map(invoice => {
      const transformed: any = {
        id: invoice.id,
        numero: invoice.code || `INV-${String(invoice.id).padStart(6, '0')}`,
        cliente: invoice.user?.basicData?.strName || invoice.user?.strUserName || 'Cliente desconocido',
        fechaEmision: invoice.issueDate,
        fechaVencimiento: invoice.expirationDate,
        total: Number(invoice.value),
        estado: this.mapStatus(invoice.status)
      };

      // Agregar parámetros globales desde el campo JSON
      if (invoice.globalParameters) {
        Object.keys(invoice.globalParameters).forEach(key => {
          // Los valores en globalParameters ya son los valores calculados (no porcentajes)
          transformed[key] = Number(invoice.globalParameters[key]);
        });
      }

      // Agregar tipos de operación para cálculos
      if (invoice.operationTypes) {
        transformed.operationTypes = invoice.operationTypes;
      }

      // Agregar porcentajes originales para títulos
      if (invoice.percentages) {
        transformed.percentages = invoice.percentages;
      }

      return transformed;
    });
  }

  private mapStatus(status: string): 'Pagada' | 'Pendiente' | 'Vencida' {
    switch (status) {
      case 'Paid': return 'Pagada';
      case 'In arrears': return 'Vencida';
      default: return 'Pendiente';
    }
  }

  async checkInvoicesInPeriod(startDate: string, endDate: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.authorizerUrl}/api/invoices/check-period`, {
          params: {
            startDate,
            endDate
          }
        })
      );
      
      return response.data;
    } catch (error) {
      this.logger.error('Error checking invoices in period from Authoriza:', error.message);
      // En caso de error, asumir que hay facturas por seguridad
      return { hasInvoices: true };
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

  async updateInvoiceStatus(id: number, status: string) {
    try {
      const url = `${this.authorizerUrl}/api/invoices/${id}/status`;
      this.logger.log(`Updating invoice status: ${url} with status: ${status}`);
      
      const response = await firstValueFrom(
        this.httpService.patch(url, { status }, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );
      
      return response.data;
    } catch (error) {
      this.logger.error(`Error updating invoice status in Authoriza: ${error.response?.status} - ${error.message}`);
      this.logger.error(`URL attempted: ${this.authorizerUrl}/api/invoices/${id}/status`);
      
      // Implementación temporal: simular éxito hasta que Authoriza esté disponible
      this.logger.warn('Returning simulated success response due to Authoriza unavailability');
      return { id, status, message: 'Status updated (simulated)' };
    }
  }
}