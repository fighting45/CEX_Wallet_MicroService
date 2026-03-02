import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

/**
 * EncryptionModule
 *
 * Makes EncryptionService available to other modules
 * By exporting it, other modules can import this module and use the service
 */
@Module({
  providers: [EncryptionService], // Register the service
  exports: [EncryptionService], // Make it available to other modules
})
export class EncryptionModule {}
