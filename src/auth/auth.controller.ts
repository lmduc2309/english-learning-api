import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, AuthResponseDto, UserDto } from './dto/auth.dto';
import {
  NativeAuthorizeDto,
  NativeAuthorizeResponseDto,
  NativeTokenDto,
} from './dto/native-auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Authentication')
@Controller('serious/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully',
    type: UserDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@Request() req): Promise<UserDto> {
    return this.authService.getProfile(req.user.userId);
  }

  @Post('native/authorize')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a one-time PKCE code for the macOS app' })
  async authorizeNativeClient(
    @Request() req,
    @Body() dto: NativeAuthorizeDto,
  ): Promise<NativeAuthorizeResponseDto> {
    return this.authService.authorizeNativeClient(req.user.userId, dto);
  }

  @Post('native/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a one-time native PKCE code' })
  async exchangeNativeCode(
    @Body() dto: NativeTokenDto,
  ): Promise<AuthResponseDto> {
    return this.authService.exchangeNativeCode(dto);
  }
}
