import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Простая защита админ-эндпоинтов общим секретом.
 * Фронт-админка передаёт ключ в заголовке `x-admin-key`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      throw new UnauthorizedException('Admin API key not configured');
    }
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-admin-key'];
    if (typeof provided !== 'string' || provided !== expected) {
      throw new UnauthorizedException('Invalid admin key');
    }
    return true;
  }
}
