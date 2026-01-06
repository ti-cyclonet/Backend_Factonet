import { Injectable } from '@nestjs/common';

@Injectable()
export class ContractsService {
  async findAll(authToken?: string) {
    try {
      const response = await fetch('http://localhost:3000/api/contracts?limit=100&offset=0', {
        headers: {
          'Authorization': authToken || `Bearer ${process.env.JWT_SECRET}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch contracts');
      }
      
      const result = await response.json();
      return result.data || result;
    } catch (error) {
      // Fallback a datos mock si falla la conexión
      return [
        {
          id: '1',
          user: 'Juan Pérez [FACTONET-BACKEND]',
          package: 'Premium',
          value: 1500.00,
          payday: 15,
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          status: 'Active'
        },
        {
          id: '2',
          user: 'María García [FACTONET-BACKEND]',
          package: 'Basic',
          value: 800.00,
          payday: 30,
          startDate: '2024-02-01',
          endDate: '2024-11-30',
          status: 'Pending'
        }
      ];
    }
  }

  async updateStatus(contractId: string, status: string, authToken?: string) {
    try {
      console.log(`Attempting to update contract ${contractId} to status ${status}`);
      const response = await fetch(`http://localhost:3000/api/contracts/${contractId}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': authToken || `Bearer ${process.env.JWT_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
      });
      
      console.log(`Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.log(`Error response:`, errorData);
        
        // Re-lanzar el error original con el mismo status y mensaje
        const error = new Error(errorData.message || 'Failed to update contract status');
        (error as any).status = response.status;
        (error as any).response = { data: errorData };
        throw error;
      }
      
      const result = await response.json();
      console.log('Update successful:', result);
      return result;
    } catch (error) {
      console.error('Error updating contract status:', error.message);
      throw error;
    }
  }

  async uploadContractPDF(contractId: string, pdfBuffer: Buffer, authToken?: string): Promise<string> {
    try {
      const base64PDF = pdfBuffer.toString('base64');
      
      const response = await fetch(`http://localhost:3000/api/contracts/${contractId}/pdf`, {
        method: 'POST',
        headers: {
          'Authorization': authToken || `Bearer ${process.env.JWT_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pdfBuffer: base64PDF })
      });
      
      if (!response.ok) {
        throw new Error('Failed to upload PDF');
      }
      
      const result = await response.json();
      return result.pdfUrl;
    } catch (error) {
      console.error('Error uploading PDF:', error);
      throw new Error('Failed to upload PDF to server');
    }
  }
}