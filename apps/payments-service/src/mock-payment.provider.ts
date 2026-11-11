import { Injectable } from '@nestjs/common';

/** Это не интеграция с банком: подтверждение задаётся учебной кнопкой. */
@Injectable()
export class MockPaymentProvider {
  readonly name = 'mock';

  create() {
    return { provider: this.name, status: 'pending' as const };
  }
}
