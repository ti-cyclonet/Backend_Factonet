import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { billingScope } from '../common/authoriza-internal';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);
  private readonly authorizerUrl: string;
  private readonly EXCLUDED_TENANT_NAME = 'cyclonet';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.authorizerUrl = this.configService.get<string>('AUTH_SERVICE_URL', 'http://localhost:3000');
  }

  async findAll(tenantId?: string, rol?: string, authToken?: string) {
    // Cliente: solo los contratos de su tenant; admin: todos; otro rol: 403
    const scope = billingScope(rol, tenantId);
    try {
      const url = 'tenantId' in scope
        ? `${this.authorizerUrl}/api/contracts/tenant/${scope.tenantId}`
        : `${this.authorizerUrl}/api/contracts?limit=100&offset=0`;

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            ...(authToken ? { 'Authorization': authToken } : {}),
            'Content-Type': 'application/json'
          }
        })
      );
      
      const rawData = response.data?.data || response.data || [];
      const contracts = Array.isArray(rawData) ? rawData : [rawData];

      // No filtrar para adminFactonet ni adminInvoices (son sus propios datos)
      if (rol === 'adminFactonet' || rol === 'adminInvoices') {
        // Filter out internal/dev contracts (isBillable=false AND showInLanding=false)
        // Keep: billable contracts (paid plans) + free commercial plans (showInLanding=true)
        return contracts.filter((contract: any) => {
          const pkg = contract.package;
          if (!pkg) return true;
          const isInternal = pkg.isBillable === false && pkg.showInLanding === false;
          return !isInternal;
        });
      }
      return contracts.filter((contract: any) => !this.isCyclonetTenant(contract));
    } catch (error) {
      this.logger.error('Error fetching contracts from Authoriza:', error.message);
      return [];
    }
  }

  private isCyclonetTenant(contract: any): boolean {
    const businessName = (contract.user?.basicData?.legalEntityData?.businessName || '').toLowerCase();
    return businessName.includes(this.EXCLUDED_TENANT_NAME);
  }

  async updateStatus(contractId: string, status: string, authToken?: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.patch(`${this.authorizerUrl}/api/contracts/${contractId}/status`, 
          { status },
          {
            headers: {
              ...(authToken ? { 'Authorization': authToken } : {}),
              'Content-Type': 'application/json'
            }
          }
        )
      );
      return response.data;
    } catch (error) {
      // Propagate the original error message from Authoriza
      const message = error.response?.data?.message || error.message || 'Error updating contract status';
      const statusCode = error.response?.status || 500;
      const err = new Error(message);
      (err as any).status = statusCode;
      (err as any).response = { data: { message } };
      throw err;
    }
  }

  async uploadContractPDF(contractId: string, pdfBuffer: Buffer, authToken?: string): Promise<string> {
    try {
      const base64PDF = pdfBuffer.toString('base64');
      
      const response = await firstValueFrom(
        this.httpService.post(`${this.authorizerUrl}/api/contracts/${contractId}/pdf`,
          { pdfBuffer: base64PDF },
          {
            headers: {
              ...(authToken ? { 'Authorization': authToken } : {}),
              'Content-Type': 'application/json'
            }
          }
        )
      );
      
      return response.data.pdfUrl;
    } catch (error) {
      this.logger.error('Error uploading PDF:', error.message);
      throw new Error('Failed to upload PDF to server');
    }
  }

  async signContract(contractId: string, authToken?: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.patch(`${this.authorizerUrl}/api/contracts/${contractId}/sign`,
          {},
          {
            headers: {
              ...(authToken ? { 'Authorization': authToken } : {}),
              'Content-Type': 'application/json'
            }
          }
        )
      );
      return response.data;
    } catch (error) {
      this.logger.error('Error signing contract:', error.message);
      const message = error.response?.data?.message || error.message || 'Error signing contract';
      const err = new Error(message);
      (err as any).status = error.response?.status || 500;
      (err as any).response = { data: { message } };
      throw err;
    }
  }

  async issueContract(contractId: string, authToken?: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.patch(`${this.authorizerUrl}/api/contracts/${contractId}/issue`,
          {},
          {
            headers: {
              ...(authToken ? { 'Authorization': authToken } : {}),
              'Content-Type': 'application/json'
            }
          }
        )
      );
      return response.data;
    } catch (error) {
      this.logger.error('Error issuing contract:', error.message);
      const message = error.response?.data?.message || error.message || 'Error issuing contract';
      const err = new Error(message);
      (err as any).status = error.response?.status || 500;
      (err as any).response = { data: { message } };
      throw err;
    }
  }
}