import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Create the NestJS application instance
  // Similar to creating a Laravel application instance
  const app = await NestFactory.create(AppModule);

  // Set global prefix for all routes (like Laravel's route prefix)
  app.setGlobalPrefix('api');

  // Enable CORS for Laravel backend communication
  app.enableCors({
    origin: process.env.LARAVEL_URL || '*',
    credentials: true,
  });

  // Start the server on port 3000 (configurable via env)
  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 Wallet Service is running on: http://localhost:${port}/api`);
}

bootstrap();
