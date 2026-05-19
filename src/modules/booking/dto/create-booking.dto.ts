import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum DirectionDto {
  MARKETING = 'MARKETING',
  IT = 'IT',
}

export class CreateBookingDto {
  @IsEnum(DirectionDto)
  direction!: DirectionDto;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsEmail()
  email!: string;

  @Matches(/^\+?[0-9 ()-]{10,20}$/)
  phone!: string;

  @IsObject()
  answers!: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsISO8601()
  slotAt!: string;
}
