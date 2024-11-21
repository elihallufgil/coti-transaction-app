import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { getEnvValidationConfig } from './configs';
import { getEnvValidationModule } from './utils/env-validation';
import { getTypeOrmModule } from './utils/db-init';
import { HttpModule } from '@nestjs/axios';
import { EthersService } from './services/ethers.service';
import { AppInitService } from './services/app-init.service';
import { CronService } from './services/cron.service';

@Module({
  imports: [
    getEnvValidationModule(getEnvValidationConfig(), '.env.coti-transactions'),
    getTypeOrmModule(),
    HttpModule,
  ],
  controllers: [AppController],
  providers: [AppService, EthersService, AppInitService, CronService],
})
export class AppModule {}
