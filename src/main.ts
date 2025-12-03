import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  
  app.enableCors({
    origin: ['http://localhost:4200', 'http://localhost:4202'],
    credentials: true,
  });
  
  app.useGlobalPipes(new ValidationPipe());
  app.setGlobalPrefix('api');
  
  // Middleware para logging de requests
  app.use((req, res, next) => {
    const { method, originalUrl } = req;
    const startTime = Date.now();
    
    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - startTime;
      logger.log(`${method} ${originalUrl} - ${statusCode} - ${duration}ms`);
    });
    
    next();
  });
  
  const port = process.env.PORT || 3003;
  
  // Manejo de cierre graceful
  process.on('SIGTERM', async () => {
    await app.close();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    await app.close();
    process.exit(0);
  });
  
  await app.listen(port);
  logger.log(`Backend Factonet running on port ${port}`);
  logger.log('Logging habilitado para todos los endpoints');
}
bootstrap();