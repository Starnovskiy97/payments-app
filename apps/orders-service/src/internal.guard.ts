import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    if (
      request.headers['x-internal-token'] !==
      (process.env.INTERNAL_API_TOKEN ?? 'local-learning-only')
    ) {
      throw new UnauthorizedException('Неверный межсервисный токен');
    }
    return true;
  }
}
