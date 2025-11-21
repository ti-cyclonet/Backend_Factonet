import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { configModule } from './config.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { InvoicesModule } from './invoices/invoices.module';
import { CustomersModule } from './customers/customers.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    configModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: +process.env.DB_PORT,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV === 'development',
    }),
    AuthModule,
    CommonModule,
    CloudinaryModule,
    InvoicesModule,
    CustomersModule,
    ProductsModule,
  ],
})
export class AppModule {}