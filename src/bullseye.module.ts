import { DynamicModule, Module, type InjectionToken } from '@nestjs/common';
import { BullseyeAlertFlushWorker } from './bullseye.alert.flush.worker';
import { BullseyeAlertListenerService } from './bullseye.alert-listener.service';
import { BullseyeAlertService } from './bullseye.alert.service';
import { BullseyeApiService } from './bullseye.api.service';
import { BullseyeSetupService } from './bullseye.setup';
import { BullseyeMcpService } from './mcp/bullseye.mcp.service';
import {
  BULLSEYE_OPTIONS,
  BullseyeModuleOptions,
} from './bullseye.types';

@Module({})
export class BullseyeModule {
  static forRoot(options: BullseyeModuleOptions): DynamicModule {
    return {
      module: BullseyeModule,
      global: false,
      providers: [
        {
          provide: BULLSEYE_OPTIONS,
          useValue: {
            ...options,
            backend: options.backend ?? 'bull',
            queueNames: options.queueNames ?? [],
            autoDiscoverQueues: options.autoDiscoverQueues ?? true,
          } satisfies BullseyeModuleOptions,
        },
        BullseyeApiService,
        BullseyeAlertService,
        BullseyeAlertFlushWorker,
        BullseyeAlertListenerService,
        BullseyeSetupService,
        BullseyeMcpService,
      ],
      exports: [BullseyeApiService],
    };
  }

  static forRootAsync(asyncOptions: {
    imports?: DynamicModule['imports'];
    inject?: InjectionToken[];
    useFactory: (
      ...args: unknown[]
    ) => Promise<BullseyeModuleOptions> | BullseyeModuleOptions;
  }): DynamicModule {
    return {
      module: BullseyeModule,
      global: false,
      imports: asyncOptions.imports ?? [],
      providers: [
        {
          provide: BULLSEYE_OPTIONS,
          useFactory: async (...arguments_: unknown[]) => {
            const resolved = await asyncOptions.useFactory(...arguments_);
            return {
              ...resolved,
              backend: resolved.backend ?? 'bull',
              queueNames: resolved.queueNames ?? [],
              autoDiscoverQueues: resolved.autoDiscoverQueues ?? true,
            } satisfies BullseyeModuleOptions;
          },
          inject: asyncOptions.inject ?? [],
        },
        BullseyeApiService,
        BullseyeAlertService,
        BullseyeAlertFlushWorker,
        BullseyeAlertListenerService,
        BullseyeSetupService,
        BullseyeMcpService,
      ],
      exports: [BullseyeApiService],
    };
  }
}
