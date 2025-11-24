import { Module } from '@nestjs/common';
// import { TypeOrmModule } from '@nestjs/typeorm'; <--- Esto ya lo quitaste
import { configModule } from './config.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
// Importa los módulos que causan el conflicto:
import { InvoicesModule } from './invoices/invoices.module';
import { CustomersModule } from './customers/customers.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
  configModule,
  AuthModule,
  CommonModule,
  CloudinaryModule,
    // COMENTAR ESTOS MÓDULOS:
  // InvoicesModule, 
  // CustomersModule, 
  // ProductsModule, 
  ],
})
export class AppModule {}