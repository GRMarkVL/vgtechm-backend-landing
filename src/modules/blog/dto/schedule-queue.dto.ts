import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class ScheduleQueueDto {
  /** Время публикации каждого дня, HH:MM (Asia/Almaty). */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time must be HH:MM' })
  time!: string;

  /** Дата старта очереди, YYYY-MM-DD (Asia/Almaty). По умолчанию — завтра. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  /** Раскладывать только по будням (пропускать сб/вс). */
  @IsOptional()
  @IsBoolean()
  weekdaysOnly?: boolean;

  /** Какие посты распределять. Если не задано — все черновики. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  postIds?: string[];
}
