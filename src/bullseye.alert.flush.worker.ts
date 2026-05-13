import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { BullseyeAlertService } from './bullseye.alert.service';

@Injectable()
export class BullseyeAlertFlushWorker implements OnModuleInit, OnModuleDestroy {
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly alerts: BullseyeAlertService) {}

  onModuleInit() {
    this.handle = setInterval(() => {
      void this.alerts.tryFlushDueBuckets();
    }, 250);
  }

  onModuleDestroy() {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }
}
