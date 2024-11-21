import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AddressBooksEntity,
  AesKeysEntity,
  NetworksEntity,
  Oauth2LoginProfilesEntity,
  Oauth2LoginsEntity,
  OtpsEntity,
  TokensEntity,
  UsersEntity,
  UserWalletsEntity,
  UserWalletTokensEntity,
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
        UsersEntity,
        OtpsEntity,
        Oauth2LoginsEntity,
        Oauth2LoginProfilesEntity,
        UserWalletsEntity,
        NetworksEntity,
        AddressBooksEntity,
        AesKeysEntity,
        TokensEntity,
        UserWalletTokensEntity,
      ],
      connectTimeout: 60 * 60 * 1000,
      timezone: 'Z',
    }),
  });
}
