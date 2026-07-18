import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';

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

  async findAll(tenantId?: string, rol?: string) {
    try {
      const params: any = {};
      
      // Si el usuario tiene rol 'adminInvoices', filtrar por tenantId
      // Si tiene rol 'adminFactonet', no filtrar (ver todas las facturas)
      if (rol === 'adminInvoices' && tenantId) {
        params.tenantId = tenantId;
      }

      this.logger.log(`findAll called - rol: ${rol}, tenantId: ${tenantId}, params: ${JSON.stringify(params)}`);
      
      const response = await firstValueFrom(
        this.httpService.get(`${this.authorizerUrl}/api/invoices`, { params })
      );

      this.logger.log(`Authoriza returned ${response.data?.length || 0} invoices`);

      let invoices = response.data || [];

      // For adminInvoices (clients): hide Unconfirmed invoices
      if (rol === 'adminInvoices') {
        invoices = invoices.filter((inv: any) => inv.status !== 'Unconfirmed');
      }
      
      return this.mapInvoices(invoices);
    } catch (error) {
      this.logger.error(`Error fetching invoices from Authoriza: ${error.message}`, error.stack);
      return [];
    }
  }

  async getProfitReport(startDate: string, endDate: string, contractId?: string) {
    try {
      const params: any = { startDate, endDate };
      if (contractId) params.contractId = contractId;
      
      const response = await firstValueFrom(
        this.httpService.get(`${this.authorizerUrl}/api/invoices/profit-report`, { params })
      );
      
      return response.data;
    } catch (error) {
      this.logger.error('Error fetching profit report from Authoriza:', error.message);
      return { totalInvoiced: 0, totalProfit: 0, invoiceCount: 0, details: [] };
    }
  }

  private mapInvoices(invoices: any[]) {
    return invoices
      .map(invoice => {
      const basicData = invoice.user?.basicData;
      const legalEntity = basicData?.legalEntityData;
      const naturalPerson = basicData?.naturalPersonData;
      const contract = invoice.contract;

      const transformed: any = {
        id: invoice.id,
        numero: invoice.code || `INV-${String(invoice.id).padStart(6, '0')}`,
        cliente: legalEntity?.businessName || invoice.user?.strUserName || 'N/A',
        fechaEmision: invoice.issueDate,
        fechaVencimiento: invoice.expirationDate,
        fechaPago: invoice.paymentDate,
        total: Number(invoice.value),
        estado: invoice.status,
        // Constancia de pago
        paymentVoucherUrl: invoice.paymentVoucherUrl || null,
        // Rejection reason (if payment was rejected)
        rejectionReason: invoice.rejectionReason || null,
        // Datos del cliente para la factura
        clienteNit: basicData?.documentNumber || '',
        clienteTipoPersona: basicData?.strPersonType || '',
        clienteEmail: invoice.user?.strUserName || '',
        clienteContacto: legalEntity?.contactName || (naturalPerson ? `${naturalPerson.firstName || ''} ${naturalPerson.firstSurname || ''}`.trim() : ''),
        clienteTelefono: legalEntity?.contactPhone || '',
        clienteEmailContacto: legalEntity?.contactEmail || '',
        // Datos del contrato
        contratoCode: contract?.code || '',
        contratoModo: contract?.mode || '',
        contratoPrefijo: contract?.codePrefix || '',
        // Periodo de servicio
        periodoInicio: invoice.periodStart,
        periodoFin: invoice.periodEnd,
      };

      // Agregar parámetros globales desde el campo JSON
      if (invoice.globalParameters) {
        Object.keys(invoice.globalParameters).forEach(key => {
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

  /**
   * Register a payment with mandatory voucher file.
   * Forwards the file to Authoriza which handles Cloudinary upload.
   */
  async registerPayment(id: number, paymentDate: string, paidAmount: number, file?: Express.Multer.File) {
    try {
      // Voucher is mandatory
      if (!file) {
        throw new Error('La constancia de pago es obligatoria');
      }

      const url = `${this.authorizerUrl}/api/invoices/${id}/register-payment`;
      this.logger.log(`Forwarding payment for invoice ${id} to Authoriza with voucher file (${file.size} bytes)`);

      // Build multipart form data to forward the file to Authoriza
      const formData = new FormData();
      formData.append('paymentDate', paymentDate);
      formData.append('paidAmount', paidAmount.toString());
      formData.append('voucher', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype,
      });

      const response = await firstValueFrom(
        this.httpService.post(url, formData, {
          headers: {
            ...formData.getHeaders(),
          },
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error registering payment for invoice ${id}: ${error.message}`);
      throw new Error(error.response?.data?.message || error.message || 'Failed to register payment');
    }
  }

  /**
   * Get the payment voucher signed URL for a specific invoice.
   */
  async getPaymentVoucher(id: number) {
    try {
      const url = `${this.authorizerUrl}/api/invoices/${id}/voucher-url`;
      const response = await firstValueFrom(
        this.httpService.get(url)
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching voucher for invoice ${id}: ${error.message}`);
      throw new Error('Failed to fetch payment voucher');
    }
  }

  /**
   * Admin confirms a reported payment → Authoriza marks it as Paid.
   */
  async confirmPayment(id: number) {
    try {
      const url = `${this.authorizerUrl}/api/invoices/${id}/confirm-payment`;
      this.logger.log(`Confirming payment for invoice ${id}`);

      const response = await firstValueFrom(
        this.httpService.post(url, {}, {
          headers: { 'Content-Type': 'application/json' }
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error confirming payment for invoice ${id}: ${error.message}`);
      throw new Error(error.response?.data?.message || 'Failed to confirm payment');
    }
  }

  /**
   * Admin rejects a reported payment → Authoriza reverts to Issued.
   */
  async rejectPayment(id: number, reason?: string) {
    try {
      const url = `${this.authorizerUrl}/api/invoices/${id}/reject-payment`;
      this.logger.log(`Rejecting payment for invoice ${id}. Reason: ${reason || 'N/A'}`);

      const response = await firstValueFrom(
        this.httpService.post(url, { reason }, {
          headers: { 'Content-Type': 'application/json' }
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error rejecting payment for invoice ${id}: ${error.message}`);
      throw new Error(error.response?.data?.message || 'Failed to reject payment');
    }
  }
}