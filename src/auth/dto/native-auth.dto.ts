import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const PKCE_VALUE = /^[A-Za-z0-9_-]+$/;

export class NativeAuthorizeDto {
  @ApiProperty({ example: 'dsd-english-macos' })
  @IsIn(['dsd-english-macos'])
  client_id: string;

  @ApiProperty({ example: 'dsdenglish://auth/callback' })
  @IsIn(['dsdenglish://auth/callback'])
  redirect_uri: string;

  @ApiProperty({ description: 'Base64url SHA-256 PKCE challenge' })
  @IsString()
  @Length(43, 43)
  @Matches(PKCE_VALUE)
  code_challenge: string;
}

export class NativeTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  code: string;

  @ApiProperty({ example: 'dsd-english-macos' })
  @IsIn(['dsd-english-macos'])
  client_id: string;

  @ApiProperty({ example: 'dsdenglish://auth/callback' })
  @IsIn(['dsdenglish://auth/callback'])
  redirect_uri: string;

  @ApiProperty({ description: 'Original PKCE verifier' })
  @IsString()
  @Length(43, 128)
  @Matches(PKCE_VALUE)
  code_verifier: string;
}

export class NativeAuthorizeResponseDto {
  @ApiProperty()
  authorization_code: string;

  @ApiProperty({ example: 120 })
  expires_in: number;
}
