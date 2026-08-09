import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Second half of internal access, after JwtAuthGuard authenticates the user.
 * Both an explicit reviewer role and an environment allowlist are required, so
 * granting either one alone cannot expose an unreleased pilot.
 */
@Injectable()
export class DsdReviewerGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest()?.user;
    const allowed = new Set(
      (this.configService.get<string>('DSD_REVIEWER_USER_IDS') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
    if (
      !user?.userId
      || !['admin', 'dsd_reviewer'].includes(user.role)
      || !allowed.has(user.userId)
    ) {
      throw new ForbiddenException('DSD reviewer access is not granted');
    }
    return true;
  }
}
