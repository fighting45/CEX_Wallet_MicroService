import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WalletsModule } from './modules/wallets/wallets.module';
import { ListenersModule } from './modules/listeners/listeners.module';

/**
 * AppModule - The root module of the application
 *
 * This is the main entry point that bootstraps all other modules
 *
 * Architecture:
 * - Stateless wallet microservice (NO database)
 * - Laravel backend handles all database operations
 * - This service only performs cryptographic operations
 *
 * In NestJS, everything is organized into modules. Each module can have:
 * - controllers: Handle HTTP requests
 * - providers: Services with business logic
 * - imports: Other modules to include
 * - exports: Services to share with other modules
 *
 * Current modules:
 * - ConfigModule: Loads environment variables from .env file
 * - WalletsModule: HD wallet generation and cryptographic operations
 */
@Module({
  imports: [
    // Load environment variables (.env file)
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available everywhere
      envFilePath: '.env',
    }),

    WalletsModule, // Wallet generation and management
    ListenersModule, // Blockchain deposit listeners
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
