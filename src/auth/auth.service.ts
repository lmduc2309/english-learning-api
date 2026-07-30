import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { User } from './entities/user.entity';
import { RegisterDto, LoginDto, AuthResponseDto, UserDto } from './dto/auth.dto';
import { RedisCacheService } from '../common/cache/redis-cache.service';
import {
  NativeAuthorizeDto,
  NativeAuthorizeResponseDto,
  NativeTokenDto,
} from './dto/native-auth.dto';

interface NativeAuthorizationCode {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private cacheService: RedisCacheService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Create user
    const user = this.userRepository.create({
      name: dto.name,
      email: dto.email,
      password: hashedPassword,
    });

    await this.userRepository.save(user);

    // Generate JWT token
    const token = this.generateToken(user);

    return {
      access_token: token,
      user: this.sanitizeUser(user),
    };
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    // Find user
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Generate JWT token
    const token = this.generateToken(user);

    return {
      access_token: token,
      user: this.sanitizeUser(user),
    };
  }

  async getProfile(userId: string): Promise<UserDto> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.sanitizeUser(user);
  }

  async validateUser(userId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id: userId, isActive: true },
    });
  }

  async authorizeNativeClient(
    userId: string,
    dto: NativeAuthorizeDto,
  ): Promise<NativeAuthorizeResponseDto> {
    const user = await this.validateUser(userId);
    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const authorizationCode = randomBytes(32).toString('base64url');
    const codeRecord: NativeAuthorizationCode = {
      userId,
      clientId: dto.client_id,
      redirectUri: dto.redirect_uri,
      codeChallenge: dto.code_challenge,
    };
    await this.cacheService.set(authorizationCode, codeRecord, {
      prefix: 'native-auth',
      ttl: 120,
    });

    // Redis is the one-time-code authority. Never return a code that was not
    // actually persisted, otherwise the browser would redirect into a dead
    // native login flow.
    const stored = await this.cacheService.exists(authorizationCode, {
      prefix: 'native-auth',
    });
    if (!stored) {
      throw new ServiceUnavailableException(
        'Native account connection is temporarily unavailable',
      );
    }

    return {
      authorization_code: authorizationCode,
      expires_in: 120,
    };
  }

  async exchangeNativeCode(dto: NativeTokenDto): Promise<AuthResponseDto> {
    const codeRecord = await this.cacheService.take<NativeAuthorizationCode>(
      dto.code,
      { prefix: 'native-auth' },
    );
    if (!codeRecord) {
      throw new UnauthorizedException('Authorization code is invalid or expired');
    }

    if (
      codeRecord.clientId !== dto.client_id ||
      codeRecord.redirectUri !== dto.redirect_uri ||
      !this.pkceMatches(dto.code_verifier, codeRecord.codeChallenge)
    ) {
      throw new UnauthorizedException('Authorization code could not be verified');
    }

    const user = await this.validateUser(codeRecord.userId);
    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      access_token: this.generateToken(user),
      user: this.sanitizeUser(user),
    };
  }

  private pkceMatches(verifier: string, expectedChallenge: string): boolean {
    const actualChallenge = createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64url');
    const actual = Buffer.from(actualChallenge, 'ascii');
    const expected = Buffer.from(expectedChallenge, 'ascii');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private generateToken(user: User): string {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.sign(payload);
  }

  private sanitizeUser(user: User): UserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
    };
  }
}
