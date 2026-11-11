import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';

@Injectable()
export class ProviderSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<{ headers: Record<string, unknown> }>>();
    const timestamp = request.headers['x-provider-timestamp'];
    const signature = request.headers['x-provider-signature'];
    if (
      typeof timestamp !== 'string' ||
      !/^\d{10}$/.test(timestamp) ||
      typeof signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !request.rawBody ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300
    ) {
      throw new UnauthorizedException('Некорректная или просроченная подпись webhook');
    }
    const expected = createHmac(
      'sha256',
      process.env.PROVIDER_WEBHOOK_SECRET ?? 'local-provider-webhook-only',
    )
      .update(`${timestamp}.`)
      .update(request.rawBody)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
      throw new UnauthorizedException('Подпись webhook не совпадает');
    }
    return true;
  }
}
