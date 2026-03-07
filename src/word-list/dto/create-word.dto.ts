import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateWordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  word: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
