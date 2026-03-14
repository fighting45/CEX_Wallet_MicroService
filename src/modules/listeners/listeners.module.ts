import { Module } from '@nestjs/common';
import { ListenersController } from './listeners.controller';
import { BlockchainListenerService } from '../../services/blockchain-listener.service';

@Module({
  controllers: [ListenersController],
  providers: [BlockchainListenerService],
  exports: [BlockchainListenerService],
})
export class ListenersModule {}
