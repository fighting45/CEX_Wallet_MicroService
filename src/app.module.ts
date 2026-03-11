import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WalletsModule } from './modules/wallets/wallets.module';
import { getDatabaseConfig } from './config/database.config';

/**
 * AppModule - The root module of the application
 *
 * This is the main entry point that bootstraps all other modules
 *
 * In NestJS, everything is organized into modules. Each module can have:
 * - controllers: Handle HTTP requests
 * - providers: Services with business logic
 * - imports: Other modules to include
 * - exports: Services to share with other modules
 *
 * New additions:
 * - ConfigModule: Loads environment variables from .env file
 * - TypeOrmModule: Connects to PostgreSQL database
 */
@Module({
  imports: [
    // Load environment variables (.env file)
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available everywhere
      envFilePath: '.env',
    }),

    // Configure database connection
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => getDatabaseConfig(configService),
    }),

    WalletsModule, // Wallet generation and management
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
