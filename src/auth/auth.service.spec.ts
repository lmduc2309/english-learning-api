import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
  .replace(/[.~]/g, '_')
  .slice(0, 64);

describe('AuthService native PKCE exchange', () => {
  const user = {
    id: 'user-1',
    email: 'learner@example.com',
    name: 'Learner',
    avatar: null,
    role: 'user',
    isActive: true,
  } as any;

  function createService() {
    const records = new Map<string, unknown>();
    const repository = {
      findOne: jest.fn().mockResolvedValue(user),
    } as any;
    const jwt = {
      sign: jest.fn().mockReturnValue('native-jwt'),
    } as any;
    const cache = {
      set: jest.fn(async (key: string, value: unknown) => records.set(key, value)),
      exists: jest.fn(async (key: string) => records.has(key)),
      take: jest.fn(async (key: string) => {
        const value = records.get(key) ?? null;
        records.delete(key);
        return value;
      }),
    } as any;
    return {
      service: new AuthService(repository, jwt, cache),
      cache,
    };
  }

  it('issues and exchanges a one-time PKCE authorization code', async () => {
    const { createHash } = await import('crypto');
    const challenge = createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64url');
    const { service } = createService();
    const issued = await service.authorizeNativeClient('user-1', {
      client_id: 'dsd-english-macos',
      redirect_uri: 'dsdenglish://auth/callback',
      code_challenge: challenge,
    });

    const response = await service.exchangeNativeCode({
      code: issued.authorization_code,
      client_id: 'dsd-english-macos',
      redirect_uri: 'dsdenglish://auth/callback',
      code_verifier: verifier,
    });

    expect(response.access_token).toBe('native-jwt');
    expect(response.user.email).toBe(user.email);
    await expect(
      service.exchangeNativeCode({
        code: issued.authorization_code,
        client_id: 'dsd-english-macos',
        redirect_uri: 'dsdenglish://auth/callback',
        code_verifier: verifier,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('consumes and rejects a code when the verifier is wrong', async () => {
    const { createHash } = await import('crypto');
    const challenge = createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64url');
    const { service } = createService();
    const issued = await service.authorizeNativeClient('user-1', {
      client_id: 'dsd-english-macos',
      redirect_uri: 'dsdenglish://auth/callback',
      code_challenge: challenge,
    });

    await expect(
      service.exchangeNativeCode({
        code: issued.authorization_code,
        client_id: 'dsd-english-macos',
        redirect_uri: 'dsdenglish://auth/callback',
        code_verifier: 'x'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
