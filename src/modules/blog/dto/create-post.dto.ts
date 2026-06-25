import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LocalizedTextDto } from './localized-text.dto';

export enum PostStatusDto {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export class CreatePostDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be kebab-case (a-z, 0-9, hyphens)',
  })
  @MaxLength(120)
  slug?: string;

  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title!: LocalizedTextDto;

  @ValidateNested()
  @Type(() => LocalizedTextDto)
  excerpt!: LocalizedTextDto;

  @ValidateNested()
  @Type(() => LocalizedTextDto)
  content!: LocalizedTextDto;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  coverImageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(PostStatusDto)
  status?: PostStatusDto;
}
