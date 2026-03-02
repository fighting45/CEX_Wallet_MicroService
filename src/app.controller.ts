import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * AppController - Handles HTTP requests
 *
 * This is like a Laravel controller. The @Controller decorator
 * tells NestJS this class handles HTTP routes.
 *
 * Route decorators (@Get, @Post, etc.) are like Laravel's Route::get(), Route::post()
 */
@Controller()
export class AppController {
  /**
   * Dependency Injection - NestJS automatically injects AppService
   * Similar to Laravel's constructor injection
   */
  constructor(private readonly appService: AppService) {}

  /**
   * GET /api/
   * Health check endpoint
   */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * GET /api/health
   * Health check endpoint for monitoring
   */
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Exbotix Wallet Service',
    };
  }
}
