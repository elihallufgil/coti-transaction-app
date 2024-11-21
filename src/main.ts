import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { getCorsConfig } from './configs';
import fastifyCors from '@fastify/cors';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import { CotiTransactionsEnvVariableNames } from './types/env-validation.type';

async function bootstrap() {
  const logger = new Logger('Coti-transactions');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: process.env.APP_ADAPTER_TRUST_PROXY == 'true',
      logger: process.env.APP_ADAPTER_LOGGER_ENABLED == 'true',
    }),
  );
  const configService: ConfigService = app.get(ConfigService);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      stopAtFirstError: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(app.get(HttpAdapterHost)));
  const corsConfig = getCorsConfig();
  await app.register(fastifyCors, corsConfig);
  await app.register(helmet);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Coti transactions')
    .setDescription('Coti transactions activity on coti 2')
    .setVersion('1.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, swaggerDocument);
  const port = configService.get<string>(CotiTransactionsEnvVariableNames.PORT);
  await app.listen(port, '0.0.0.0');
  logger.log(`Load test running at port ${port}`);
}
bootstrap();
