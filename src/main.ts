import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configuredOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';

  // Same-origin web requests and native mobile requests do not need a CORS
  // header. In production, only explicitly configured browser origins receive
  // one; development remains permissive for local ports and Expo tooling.
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || !isProduction || configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
  });

  if (isProduction) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('English Learning API')
    .setDescription('API for English learning application with LLM integration')
    .setVersion('1.0')
    .addTag('LLM')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('serious/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/serious/docs`);
}
bootstrap();
