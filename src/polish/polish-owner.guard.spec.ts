import { ForbiddenException } from '@nestjs/common';
import { PolishOwnerGuard } from './polish-owner.guard';

function context(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function guardWith(ids: string | undefined) {
  const config = {
    get: jest.fn((key: string) => (key === 'POLISH_OWNER_USER_IDS' ? ids : undefined)),
  } as any;
  return new PolishOwnerGuard(config);
}

describe('PolishOwnerGuard', () => {
  it('allows a listed user', () => {
    expect(guardWith('owner-1, owner-2').canActivate(context({ userId: 'owner-2' }))).toBe(true);
  });

  it('rejects an unlisted user', () => {
    expect(() => guardWith('owner-1').canActivate(context({ userId: 'other' }))).toThrow(
      ForbiddenException,
    );
  });

  it.each(['', undefined, ' , '])('fails closed when allowlist is %j', (ids) => {
    expect(() => guardWith(ids).canActivate(context({ userId: 'owner-1' }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when request.user is missing', () => {
    expect(() => guardWith('owner-1').canActivate(context(undefined))).toThrow(ForbiddenException);
  });
});
