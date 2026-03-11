import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

/**
 * TypeORM Database Configuration
 *
 * Configures PostgreSQL connection for wallet service
 */
export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 5432),
  username: configService.get<string>('DB_USER', 'wallet_service'),
  password: configService.get<string>('DB_PASSWORD', 'dev_password_change_in_production'),
  database: configService.get<string>('DB_NAME', 'exbotix_wallet'),

  // Auto-load entities from the entities folder
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],

  // Migrations configuration
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],

  // Development settings
  synchronize: configService.get<string>('NODE_ENV') === 'development', // Auto-sync schema in dev
  logging: configService.get<string>('NODE_ENV') === 'development', // SQL logging in dev

  // Connection pool settings
  extra: {
    max: 20, // Maximum connections in pool
    min: 5,  // Minimum connections in pool
  },

  // Retry configuration
  retryAttempts: 3,
  retryDelay: 3000,
});
