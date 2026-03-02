import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

/**
 * AppModule - The root module of the application
 *
 * Think of this like Laravel's AppServiceProvider - it bootstraps the entire application
 *
 * In NestJS, everything is organized into modules. Each module can have:
 * - controllers: Handle HTTP requests (like Laravel controllers)
 * - providers: Services with business logic (like Laravel services)
 * - imports: Other modules to include
 * - exports: Services to share with other modules
 */
@Module({
  imports: [],  // Other modules will go here (Database, Auth, Wallets, etc.)
  controllers: [AppController],  // HTTP route handlers
  providers: [AppService],  // Injectable services with business logic
})
export class AppModule {}
