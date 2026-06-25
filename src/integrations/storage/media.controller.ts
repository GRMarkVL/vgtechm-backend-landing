import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { BLOG_PREFIX, StorageService } from './storage.service';

const SAFE_FILE = /^[a-zA-Z0-9._-]+$/;

@Controller('media')
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Throttle({ short: { limit: 120, ttl: 60_000 } })
  @Get('blog/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async blogMedia(@Param('file') file: string, @Res() res: Response) {
    if (!SAFE_FILE.test(file)) {
      throw new BadRequestException('Invalid file name');
    }
    try {
      const { stream, contentType } = await this.storage.getObject(
        `${BLOG_PREFIX}/${file}`,
      );
      res.setHeader('Content-Type', contentType);
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).end();
      });
      stream.pipe(res);
    } catch {
      throw new NotFoundException('Media not found');
    }
  }
}
