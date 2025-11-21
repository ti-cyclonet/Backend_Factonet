import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { PaginationDto } from '../common/dtos/pagination.dto';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private invoiceItemsRepository: Repository<InvoiceItem>,
  ) {}

  async create(createInvoiceDto: CreateInvoiceDto): Promise<Invoice> {
    const { items, ...invoiceData } = createInvoiceDto;
    
    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const tax = subtotal * 0.19; // 19% tax
    const total = subtotal + tax;
    
    // Generate invoice number
    const invoiceNumber = await this.generateInvoiceNumber();
    
    const invoice = this.invoicesRepository.create({
      ...invoiceData,
      invoiceNumber,
      subtotal,
      tax,
      total,
      issueDate: new Date(invoiceData.issueDate),
      dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : null,
    });
    
    const savedInvoice = await this.invoicesRepository.save(invoice);
    
    // Create invoice items
    const invoiceItems = items.map(item => 
      this.invoiceItemsRepository.create({
        ...item,
        invoiceId: savedInvoice.id,
        total: item.quantity * item.unitPrice,
      })
    );
    
    await this.invoiceItemsRepository.save(invoiceItems);
    
    return this.findOne(savedInvoice.id);
  }

  async findAll(paginationDto: PaginationDto): Promise<Invoice[]> {
    const { limit, offset } = paginationDto;
    return await this.invoicesRepository.find({
      take: limit,
      skip: offset,
      relations: ['customer', 'items', 'items.product'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Invoice> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id },
      relations: ['customer', 'items', 'items.product'],
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
    return invoice;
  }

  async update(id: number, updateInvoiceDto: UpdateInvoiceDto): Promise<Invoice> {
    const invoice = await this.findOne(id);
    Object.assign(invoice, updateInvoiceDto);
    await this.invoicesRepository.save(invoice);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    const invoice = await this.findOne(id);
    await this.invoicesRepository.remove(invoice);
  }

  private async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.invoicesRepository.count();
    return `INV-${year}-${(count + 1).toString().padStart(6, '0')}`;
  }
}