import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class ProviderApiGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    if (
      request.headers['x-provider-token'] !==
      (process.env.PROVIDER_API_TOKEN ?? 'local-provider-api-only')
    ) {
      throw new UnauthorizedException('Неверный API-токен провайдера');
    }
    return true;
  }
}
