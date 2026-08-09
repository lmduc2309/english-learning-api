import { ForbiddenException } from '@nestjs/common';
import { DsdReviewerGuard } from './dsd-reviewer.guard';

function context(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('DsdReviewerGuard', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'DSD_REVIEWER_USER_IDS' ? 'reviewer-1, reviewer-2' : undefined,
    ),
  } as any;
  const guard = new DsdReviewerGuard(config);

  it('requires authentication, a reviewer role and explicit allowlisting', () => {
    expect(
      guard.canActivate(context({ userId: 'reviewer-1', role: 'dsd_reviewer' })),
    ).toBe(true);
  });

  it.each([
    undefined,
    { userId: 'reviewer-1', role: 'user' },
    { userId: 'not-listed', role: 'dsd_reviewer' },
  ])('fails closed for %j', (user) => {
    expect(() => guard.canActivate(context(user))).toThrow(ForbiddenException);
  });
});
