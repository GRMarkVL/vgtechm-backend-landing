import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { parseCorsOrigins, validateEnv } from './common/env/env.validation';

async function bootstrap() {
  validateEnv();
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: parseCorsOrigins(), credentials: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 4005, '0.0.0.0');
}
bootstrap();
