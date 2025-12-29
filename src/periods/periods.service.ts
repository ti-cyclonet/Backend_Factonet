import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreatePeriodDto } from './dto/create-period.dto';

@Injectable()
export class PeriodsService {
  private readonly authorizaUrl: string;

  constructor(private configService: ConfigService) {
    this.authorizaUrl = this.configService.get<string>('AUTHORIZA_API_URL') || 'http://localhost:3000';
  }

  async create(createPeriodDto: CreatePeriodDto) {
    try {
      console.log('Connecting to:', `${this.authorizaUrl}/api/periods`);
      console.log('Payload:', createPeriodDto);
      
      // Convertir fechas a formato ISO
      const payload = {
        name: createPeriodDto.nombre,
        startDate: createPeriodDto.fechaInicio + 'T00:00:00Z',
        endDate: createPeriodDto.fechaFin + 'T23:59:59Z',
      };
      
      console.log('ISO Payload:', payload);
      
      const response = await fetch(`${this.authorizaUrl}/api/periods`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log('Error response:', errorText);
        throw new HttpException(`Error creating period: ${errorText}`, HttpStatus.BAD_GATEWAY);
      }

      return await response.json();
    } catch (error) {
      console.error('Connection error:', error);
      throw new HttpException(`Failed to connect to Authoriza service: ${error.message}`, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async getGlobalParameters() {
    try {
      const response = await fetch(`${this.authorizaUrl}/api/global-parameters`);
      
      if (!response.ok) {
        throw new HttpException('Error fetching global parameters from Authoriza', HttpStatus.BAD_GATEWAY);
      }

      return await response.json();
    } catch (error) {
      throw new HttpException('Failed to connect to Authoriza service', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async addParametersToPeriod(periodId: string, parametros: any[]) {
    try {
      const response = await fetch(`${this.authorizaUrl}/api/periods/${periodId}/parameters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parametros }),
      });
      
      if (!response.ok) {
        throw new HttpException('Error adding parameters to period in Authoriza', HttpStatus.BAD_GATEWAY);
      }

      return await response.json();
    } catch (error) {
      throw new HttpException('Failed to connect to Authoriza service', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async getParametersByPeriod(periodId: string) {
    try {
      const response = await fetch(`${this.authorizaUrl}/api/periods/${periodId}/parameters`);
      
      if (!response.ok) {
        throw new HttpException('Error fetching parameters from Authoriza', HttpStatus.BAD_GATEWAY);
      }

      return await response.json();
    } catch (error) {
      throw new HttpException('Failed to connect to Authoriza service', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async findAll() {
    try {
      const response = await fetch(`${this.authorizaUrl}/api/periods`);
      
      if (!response.ok) {
        throw new HttpException('Error fetching periods from Authoriza', HttpStatus.BAD_GATEWAY);
      }

      return await response.json();
    } catch (error) {
      throw new HttpException('Failed to connect to Authoriza service', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async updateParameterStatus(parameterId: string, status: string) {
    try {
      console.log(`[FACTONET] Updating parameter ${parameterId} status to: ${status}`);
      const response = await fetch(`${this.authorizaUrl}/api/global-parameters-periods/${parameterId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      
      console.log(`[FACTONET] Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[FACTONET] Error response: ${errorText}`);
        throw new HttpException('Error updating parameter status in Authoriza', HttpStatus.BAD_GATEWAY);
      }

      const result = await response.json();
      console.log(`[FACTONET] Success result:`, result);
      return result;
    } catch (error) {
      console.error(`[FACTONET] Error updating parameter status:`, error);
      throw new HttpException('Failed to connect to Authoriza service', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async updateParameterValue(parameterId: string, value: string) {
    try {
      console.log(`[FACTONET] Updating parameter ${parameterId} value to: ${value}`);
      const response = await fetch(`${this.authorizaUrl}/api/global-parameters-periods/${parameterId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value }),
      });
      
      console.log(`[FACTONET] Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[FACTONET] Error response: ${errorText}`);
        throw new HttpException('Error updating parameter value in Authoriza', HttpStatus.BAD_GATEWAY);
      }

      const result = await response.json();
      console.log(`[FACTONET] Success result:`, result);
      return result;
    } catch (error) {
      console.error(`[FACTONET] Error updating parameter value:`, error);
      throw new HttpException('Failed to connect to Authoriza service', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async updateParameter(parameterId: string, data: any) {
    try {
      console.log(`[FACTONET] Updating parameter ${parameterId} with:`, data);
      const response = await fetch(`${this.authorizaUrl}/api/global-parameters-periods/${parameterId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      console.log(`[FACTONET] Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[FACTONET] Error response: ${errorText}`);
        throw new HttpException('Error updating parameter in Authoriza', HttpStatus.BAD_GATEWAY);
      }

      const result = await response.json();
      console.log(`[FACTONET] Success result:`, result);
      return result;
    } catch (error) {
      console.error(`[FACTONET] Error updating parameter:`, error);
      throw new HttpException('Failed to connect to Authoriza service', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async deleteParameter(parameterId: string) {
    try {
      console.log(`[FACTONET] Deleting parameter ${parameterId}`);
      const response = await fetch(`${this.authorizaUrl}/api/global-parameters-periods/${parameterId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log(`[FACTONET] Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[FACTONET] Error response: ${errorText}`);
        throw new HttpException('Error deleting parameter in Authoriza', HttpStatus.BAD_GATEWAY);
      }

      const result = await response.json();
      console.log(`[FACTONET] Delete result:`, result);
      return result;
    } catch (error) {
      console.error(`[FACTONET] Error deleting parameter:`, error);
      throw new HttpException('Failed to connect to Authoriza service', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}