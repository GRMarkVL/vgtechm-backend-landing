import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminGuard } from '../../common/guards/admin.guard';
import { StorageService } from '../../integrations/storage/storage.service';
import { BlogService } from './blog.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ScheduleQueueDto } from './dto/schedule-queue.dto';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

@UseGuards(AdminGuard)
@Controller('admin/blog')
export class BlogAdminController {
  constructor(
    private readonly blog: BlogService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list() {
    return this.blog.adminList();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.blog.adminGet(id);
  }

  @Post()
  async create(@Body() dto: CreatePostDto) {
    return this.blog.create(dto);
  }

  @Post('schedule-queue')
  async scheduleQueue(@Body() dto: ScheduleQueueDto) {
    return this.blog.scheduleQueue(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.blog.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.blog.remove(id);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\/(jpeg|jpg|png|webp|gif|avif|svg\+xml)$/ })
        .addMaxSizeValidator({ maxSize: MAX_IMAGE_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
  ) {
    if (!this.storage.isImage(file.mimetype)) {
      throw new BadRequestException('Unsupported image type');
    }
    return this.storage.uploadImage(file.buffer, file.mimetype);
  }
}
