import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';
import { authorizaInternalHeaders, billingScope } from '../common/authoriza-internal';
import { errorDeAuthoriza } from '../common/authoriza-error';

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
    // Fuera del try: un rol sin acceso recibe 403, no una lista vacía
    const scope = billingScope(rol, tenantId);
    try {
      const params: any = {};
      if ('tenantId' in scope) params.tenantId = scope.tenantId;

      this.logger.log(`findAll called - rol: ${rol}, tenantId: ${tenantId}, params: ${JSON.stringify(params)}`);
      
      const response = await firstValueFrom(
        this.httpService.get(`${this.authorizerUrl}/api/invoices`, { params, headers: authorizaInternalHeaders() })
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
      // Antes devolvía []: si Authoriza fallaba, el cliente veía "no tienes
      // facturas" y el tablero en cero, como si no debiera nada.
      throw errorDeAuthoriza(error, 'No se pudieron consultar las facturas. Intenta de nuevo en un momento.');
    }
  }

  async getProfitReport(startDate: string, endDate: string, contractId?: string) {
    try {
      const params: any = { startDate, endDate };
      if (contractId) params.contractId = contractId;
      
      const response = await firstValueFrom(
        this.httpService.get(`${this.authorizerUrl}/api/invoices/profit-report`, { params, headers: authorizaInternalHeaders() })
      );
      
      return response.data;
    } catch (error) {
      this.logger.error('Error fetching profit report from Authoriza:', error.message);
      return { totalInvoiced: 0, totalProfit: 0, invoiceCount: 0, details: [] };
    }
  }

  /**
   * El cliente solo puede operar sobre facturas de su tenant (reportar pago,
   * ver la constancia). El administrador de FactoNet, sobre cualquiera.
   */
  async assertInvoiceAccess(id: number, tenantId?: string, rol?: string) {
    const scope = billingScope(rol, tenantId);
    if ('all' in scope) return;
    const own = await this.findAll(tenantId, rol);
    if (!own.some((inv: any) => Number(inv.id) === Number(id))) {
      throw new ForbiddenException('Esta factura no pertenece a tu cuenta.');
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
          },
          headers: authorizaInternalHeaders(),
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
        this.httpService.post(url, {}, { headers: authorizaInternalHeaders() })
      );
      
      return response.data;
    } catch (error) {
      this.logger.error(`Error executing invoice sweep to ${this.authorizerUrl}:`, error.response?.status, error.message);
      throw errorDeAuthoriza(error, 'No se pudo ejecutar la revisión de facturas.');
    }
  }

  async updateInvoiceStatus(id: number, status: string) {
    try {
      const url = `${this.authorizerUrl}/api/invoices/${id}/status`;
      this.logger.log(`Updating invoice status: ${url} with status: ${status}`);
      
      const response = await firstValueFrom(
        this.httpService.patch(url, { status }, {
          headers: authorizaInternalHeaders({ 'Content-Type': 'application/json' })
        })
      );
      
      return response.data;
    } catch (error) {
      this.logger.error(`Error updating invoice status in Authoriza: ${error.response?.status} - ${error.message}`);
      this.logger.error(`URL attempted: ${this.authorizerUrl}/api/invoices/${id}/status`);
      // Antes se devolvía un "éxito simulado": la pantalla mostraba el estado
      // cambiado aunque Authoriza no lo hubiera guardado.
      throw errorDeAuthoriza(error, 'No se pudo actualizar el estado de la factura.');
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
        throw new BadRequestException('La constancia de pago es obligatoria.');
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
          headers: authorizaInternalHeaders(formData.getHeaders()),
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error registering payment for invoice ${id}: ${error.message}`);
      throw errorDeAuthoriza(error, 'No se pudo registrar el pago.');
    }
  }

  /**
   * Get the payment voucher signed URL for a specific invoice.
   */
  async getPaymentVoucher(id: number) {
    try {
      const url = `${this.authorizerUrl}/api/invoices/${id}/voucher-url`;
      const response = await firstValueFrom(
        this.httpService.get(url, { headers: authorizaInternalHeaders() })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching voucher for invoice ${id}: ${error.message}`);
      throw errorDeAuthoriza(error, 'No se pudo obtener la constancia de pago.');
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
          headers: authorizaInternalHeaders({ 'Content-Type': 'application/json' })
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error confirming payment for invoice ${id}: ${error.message}`);
      throw errorDeAuthoriza(error, 'No se pudo confirmar el pago.');
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
          headers: authorizaInternalHeaders({ 'Content-Type': 'application/json' })
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error rejecting payment for invoice ${id}: ${error.message}`);
      throw errorDeAuthoriza(error, 'No se pudo rechazar el pago.');
    }
  }
}