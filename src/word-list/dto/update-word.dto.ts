import { IsString, IsOptional } from 'class-validator';

export class UpdateWordDto {
  @IsString()
  @IsOptional()
  notes?: string;
}
