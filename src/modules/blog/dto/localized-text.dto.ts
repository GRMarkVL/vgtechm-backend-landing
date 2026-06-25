import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Локализованный текст. `ru` обязателен (дефолтная локаль сайта), остальные — опциональны. */
export class LocalizedTextDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  ru!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  en?: string;
}
