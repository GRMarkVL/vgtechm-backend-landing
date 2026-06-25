import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { MediaController } from './media.controller';

@Global()
@Module({
  controllers: [MediaController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
