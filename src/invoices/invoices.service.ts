import { Injectable } from '@nestjs/common';

@Injectable()
export class InvoicesService {
  async findAll() {
    return [
      {
        id: '1',
        numero: 'FAC-001 [FACTONET-BACKEND]',
        cliente: 'Juan Pérez',
        fechaEmision: '2024-01-15',
        fechaVencimiento: '2024-02-15',
        total: 1500.00,
        estado: 'Pendiente'
      },
      {
        id: '2',
        numero: 'FAC-002 [FACTONET-BACKEND]',
        cliente: 'María García',
        fechaEmision: '2024-01-20',
        fechaVencimiento: '2024-02-20',
        total: 2300.50,
        estado: 'Pagada'
      },
      {
        id: '3',
        numero: 'FAC-003 [FACTONET-BACKEND]',
        cliente: 'Carlos López',
        fechaEmision: '2024-01-25',
        fechaVencimiento: '2024-01-30',
        total: 850.75,
        estado: 'Vencida'
      }
    ];
  }
}