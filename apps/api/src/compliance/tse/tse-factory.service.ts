import { Injectable } from '@nestjs/common';
import { ITseProvider, TseClientConfig } from './tse-provider.interface';
import { FiskalyTseAdapter } from './fiskaly-tse.adapter';
import { SwissbitTseAdapter } from './swissbit-tse.adapter';

@Injectable()
export class TseFactory {
  create(config: TseClientConfig): ITseProvider {
    switch (config.provider) {
      case 'fiskaly':
        return new FiskalyTseAdapter();
      case 'swissbit':
        return new SwissbitTseAdapter();
      default:
        throw new Error(`Unknown TSE provider: ${config.provider}`);
    }
  }
}