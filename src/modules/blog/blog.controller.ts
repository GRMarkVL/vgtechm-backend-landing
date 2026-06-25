import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BlogService } from './blog.service';
import { ListQueryDto } from './dto/list-query.dto';

@Controller('blog')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  @Get()
  async list(@Query() query: ListQueryDto) {
    return this.blog.list(query);
  }

  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  @Get(':slug')
  async getBySlug(@Param('slug') slug: string, @Query('lang') lang?: string) {
    return this.blog.getBySlug(slug, lang);
  }
}
