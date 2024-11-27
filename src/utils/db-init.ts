import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AccountsEntity,
  ActionsEntity,
  ActivitiesEntity,
  AppStatesEntity,
  TransactionsEntity,
  NetworksEntity,
  TokensEntity,
  TokensToGenerateEntity,
} from '../entities';

export function getTypeOrmModule() {
  return TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    name: 'default',
    useFactory: (configService: ConfigService) => ({
      type: 'mysql',
      host: configService.get<string>('DB_HOST'),
      port: configService.get<number>('DB_PORT'),
      username: configService.get<string>('DB_USER'),
      password: configService.get<string>('DB_PASSWORD'),
      database: configService.get<string>('DB_NAME'),
      entities: [
        AccountsEntity,
        ActionsEntity,
        ActivitiesEntity,
        AppStatesEntity,
        NetworksEntity,
        TokensEntity,
        TransactionsEntity,
        TokensToGenerateEntity,
      ],
      connectTimeout: 60 * 60 * 1000,
      timezone: 'Z',
    }),
  });
}
