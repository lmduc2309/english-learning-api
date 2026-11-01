import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Owner-only access, after JwtAuthGuard authenticates the user. An empty or
 * unset POLISH_OWNER_USER_IDS allows nobody.
 */
@Injectable()
export class PolishOwnerGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest()?.user;
    const allowed = new Set(
      (this.configService.get<string>('POLISH_OWNER_USER_IDS') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
    if (!user?.userId || !allowed.has(user.userId)) {
      throw new ForbiddenException('Polish access is not granted');
    }
    return true;
  }
}
