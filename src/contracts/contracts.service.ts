import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

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
    try {
      let url = `${this.authorizerUrl}/api/contracts`;
      
      // Si el usuario tiene rol 'adminInvoices', usar el endpoint específico por tenant
      // Si tiene rol 'adminFactonet', usar el endpoint general
      if (rol === 'adminInvoices' && tenantId) {
        url = `${this.authorizerUrl}/api/contracts/tenant/${tenantId}`;
      } else {
        url = `${this.authorizerUrl}/api/contracts?limit=100&offset=0`;
      }
      
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            'Authorization': authToken || `Bearer ${process.env.JWT_SECRET}`,
            'Content-Type': 'application/json'
          }
        })
      );
      
      const contracts = response.data?.data || response.data || [];

      // Solo excluir el tenant interno de Cyclonet si NO es adminFactonet
      if (rol === 'adminFactonet') {
        return contracts;
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
              'Authorization': authToken || `Bearer ${process.env.JWT_SECRET}`,
              'Content-Type': 'application/json'
            }
          }
        )
      );
      return response.data;
    } catch (error) {
      throw error;
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
              'Authorization': authToken || `Bearer ${process.env.JWT_SECRET}`,
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
}