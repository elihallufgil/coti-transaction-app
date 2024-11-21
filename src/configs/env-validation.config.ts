import * as Joi from 'joi';
import { AnySchema } from 'joi';
import { ZimzamApiEnvVariableNames } from '../types/env-validation.type';

export function getEnvValidationConfig() {
  return Joi.object<{ [K in keyof typeof ZimzamApiEnvVariableNames]: AnySchema }>({
    PORT: Joi.number().integer().default(3000),
    HOST_URL: Joi.string().exist(),
    CLIENT_URL: Joi.string().exist(),
    DB_HOST: Joi.string().exist(),
    DB_PORT: Joi.number().integer().default(3306),
    DB_USER: Joi.string().exist(),
    DB_PASSWORD: Joi.string().exist(),
    DB_NAME: Joi.string().exist(),
    REDIS_HOST: Joi.string().exist(),
    REDIS_PORT: Joi.number().integer().default(6379),
    SENDGRID_API_KEY: Joi.string().exist(),
    SENDGRID_FROM_EMAIL: Joi.string().exist(),
    SENDGRID_FROM_NAME: Joi.string().exist(),
    SENDGRID_TEMPLATE_OTP: Joi.string().exist(),
    SESSION_SECRET: Joi.string().exist(),
    SESSION_SECURE_COOKIE: Joi.boolean().exist(),
    SESSION_COOKIE_NAME: Joi.string().exist(),
    SESSION_INACTIVITY_EXPIRATION_IN_MINUTES: Joi.number().integer().exist(),
    OAUTH2_GOOGLE_CLIENT_ID: Joi.string().exist(),
    OAUTH2_GOOGLE_CLIENT_SECRET: Joi.string().exist(),
    OAUTH2_GOOGLE_API_URL: Joi.string().exist(),
    OAUTH2_GOOGLE_API_USERINFO_PATH: Joi.string().exist(),
    AUTH_OTP_EXPIRATION_IN_MINUTES: Joi.number().integer().exist(),
    AUTH_BCRYPT_SALT_ROUNDS: Joi.number().integer().exist(),
  });
}
