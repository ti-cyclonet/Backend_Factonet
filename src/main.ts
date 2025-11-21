import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors({
    origin: ['http://localhost:4200', 'http://localhost:4202'],
    credentials: true,
  });
  
  app.useGlobalPipes(new ValidationPipe());
  app.setGlobalPrefix('api');
  
  const port = process.env.PORT || 3002;
  await app.listen(port);
  console.log(`Backend Factonet running on port ${port}`);
}
bootstrap();