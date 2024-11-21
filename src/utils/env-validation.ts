import { ConfigModule } from '@nestjs/config';
import { ObjectSchema } from 'joi';

export function getEnvValidationModule(validationSchema: ObjectSchema, envFileName?: string) {
  return ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: envFileName || '.env',
    validationSchema,
    validationOptions: {
      allowUnknown: true,
      abortEarly: true,
    },
  });
}
