import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WalletsModule } from './modules/wallets/wallets.module';

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
 */
@Module({
  imports: [
    WalletsModule, // Wallet generation and management
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
