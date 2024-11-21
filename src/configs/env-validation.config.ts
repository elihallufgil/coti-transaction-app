import * as Joi from 'joi';
import { AnySchema } from 'joi';
import { CotiTransactionsEnvVariableNames } from '../types/env-validation.type';

export function getEnvValidationConfig() {
  return Joi.object<{
    [K in keyof typeof CotiTransactionsEnvVariableNames]: AnySchema;
  }>({
    PORT: Joi.number().integer().default(3000),
    HOST_URL: Joi.string().exist(),
    DB_HOST: Joi.string().exist(),
    DB_PORT: Joi.number().integer().default(3306),
    DB_USER: Joi.string().exist(),
    DB_PASSWORD: Joi.string().exist(),
    DB_NAME: Joi.string().exist(),
    SEED_PHRASE: Joi.string().exist(),
    COTI_ONBOARD_CONTRACT_ADDRESS: Joi.string().exist(),
    COTI_RPC_WEBSOCKET_URL: Joi.string().exist(),
    COTI_RPC_URL: Joi.string().exist(),
    RUN_ACTIVITIES_INTERVAL_IN_SECONDS: Joi.number().exist(),
    RUN_ACTIVITIES_ENABLED: Joi.boolean().exist(),
    CHECK_TRANSACTION_COMPLETE_INTERVAL_IN_SECONDS: Joi.number().exist(),
    CHECK_TRANSACTION_COMPLETE_ENABLED: Joi.boolean().exist(),
  });
}
