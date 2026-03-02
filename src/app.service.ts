import { Injectable } from '@nestjs/common';

/**
 * AppService - Business logic layer
 *
 * The @Injectable decorator tells NestJS this class can be injected
 * into other classes (Dependency Injection).
 *
 * This is like Laravel services - they contain the actual business logic,
 * while controllers just handle HTTP requests/responses.
 *
 * Best Practice: Keep controllers thin, put logic in services
 */
@Injectable()
export class AppService {
  getHello(): string {
    return 'Welcome to Exbotix Wallet Service API!';
  }
}
