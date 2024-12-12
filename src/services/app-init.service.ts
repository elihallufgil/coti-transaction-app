import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CronService } from './cron.service';
import * as moment from 'moment';
import { DataSource } from 'typeorm';
import { exec, sleep } from '../utils/helpers';
import { AppStateNames } from '../types/app-state-names';
import { AppStatesEntity, TableNames } from '../entities';
import { CotiTransactionsEnvVariableNames } from '../types/env-validation.type';

const iterationCounter: Map<string, number> = new Map();

@Injectable()
export class AppInitService implements OnModuleInit {
  private readonly logger = new Logger(AppInitService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly cronService: CronService,
    private readonly datasource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      await this.initAppStateOnDB();
      await this.intervalInitialization();
    } catch (e) {
      this.logger.error(e);
      this.logger.error('Init service failed to initiate');
      process.exit(1);
    }
  }

  async initAppStateOnDB() {
    const manager = this.datasource.manager;
    try {
      const [appStatesError, appStates] = await exec(
        manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).find(),
      );
      if (appStatesError)
        throw new InternalServerErrorException(appStatesError);

      const appStateArr = [];
      if (
        !appStates.find(
          (appState) => appState.name === AppStateNames.ACCOUNT_INDEX,
        )
      ) {
        appStateArr.push(
          manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).create({
            name: AppStateNames.ACCOUNT_INDEX,
            value: '1',
          }),
        );
      }
      if (
        !appStates.find(
          (appState) => appState.name === AppStateNames.FAUCET_ACCOUNT_INDEX,
        )
      ) {
        appStateArr.push(
          manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).create({
            name: AppStateNames.FAUCET_ACCOUNT_INDEX,
            value: '1000000000',
          }),
        );
      }

      if (
        !appStates.find(
          (appState) => appState.name === AppStateNames.CREATE_TOKEN_LOCK,
        )
      ) {
        appStateArr.push(
          manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).create({
            name: AppStateNames.CREATE_TOKEN_LOCK,
            value: '1',
          }),
        );
      }

      if (
        !appStates.find(
          (appState) =>
            appState.name === AppStateNames.CREATE_PRIVATE_TOKEN_LOCK,
        )
      ) {
        appStateArr.push(
          manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).create({
            name: AppStateNames.CREATE_PRIVATE_TOKEN_LOCK,
            value: '1',
          }),
        );
      }

      if (appStateArr.length > 0) {
        const [appStateError] = await exec(
          manager
            .getRepository<AppStatesEntity>(TableNames.APP_STATES)
            .save(appStateArr),
        );
        if (appStateError)
          throw new InternalServerErrorException(appStateError);
      }

      return;
    } catch (error) {
      this.logger.error('[initAppStateOnDB]', error);
      throw error;
    }
  }

  async runEveryXSeconds(
    name: string,
    functionToRun: () => Promise<any>,
    minIntervalInSeconds: number,
    enable: boolean,
  ) {
    if (!enable) return;
    try {
      let lastActivationTime: number;
      iterationCounter.set(name, 1);
      while (true) {
        this.logger.log(
          `Task [${name}][iteration ${iterationCounter.get(name)}] started`,
        );
        lastActivationTime = moment.now();
        const [error] = await exec(functionToRun());
        if (error)
          this.logger.error(
            `Task [${name}][iteration ${iterationCounter.get(name)}] [${error.message || error}]`,
          );
        this.logger.log(
          `Task [${name}][iteration ${iterationCounter.get(name)}] ended`,
        );

        const now = moment.now();
        const timeDiffInSeconds = (now - lastActivationTime) / 1000;
        const sleepTime = minIntervalInSeconds - timeDiffInSeconds;
        if (sleepTime > 0) {
          await sleep(sleepTime * 1000);
        }
        iterationCounter.set(name, iterationCounter.get(name) + 1);
      }
    } catch (error) {
      this.logger.error(`Task [${name}][${error.message || error}]`);
      this.logger.error(`Task [${name}][terminated]`);
    }
  }

  async intervalInitialization(): Promise<void> {
    const runActivitiesInterval = this.configService.get<number>(
      CotiTransactionsEnvVariableNames.RUN_ACTIVITIES_INTERVAL_IN_SECONDS,
    );
    const runActivitiesEnabled = this.configService.get<boolean>(
      CotiTransactionsEnvVariableNames.RUN_ACTIVITIES_ENABLED,
    );

    const runSlowActivitiesInterval = this.configService.get<number>(
      CotiTransactionsEnvVariableNames.RUN_SLOW_ACTIVITIES_INTERVAL_IN_SECONDS,
    );
    const runSlowActivitiesEnabled = this.configService.get<boolean>(
      CotiTransactionsEnvVariableNames.RUN_SLOW_ACTIVITIES_ENABLED,
    );
    const checkTransactionCompleteInterval = this.configService.get<number>(
      CotiTransactionsEnvVariableNames.CHECK_TRANSACTION_COMPLETE_INTERVAL_IN_SECONDS,
    );
    const checkTransactionCompleteEnabled = this.configService.get<boolean>(
      CotiTransactionsEnvVariableNames.CHECK_TRANSACTION_COMPLETE_ENABLED,
    );

    const cleanStuckAccountsInterval = this.configService.get<number>(
      CotiTransactionsEnvVariableNames.CLEAN_STUCK_ACCOUNTS_INTERVAL_IN_SECONDS,
    );
    const cleanStuckAccountsEnabled = this.configService.get<boolean>(
      CotiTransactionsEnvVariableNames.CLEAN_STUCK_ACCOUNTS_ENABLED,
    );

    this.runEveryXSeconds(
      'RUN ACTIVITIES',
      this.cronService.runActivities.bind(this.cronService),
      runActivitiesInterval,
      runActivitiesEnabled,
    );

    this.runEveryXSeconds(
      'RUN SLOW ACTIVITIES',
      this.cronService.runSlowActivities.bind(this.cronService),
      runSlowActivitiesInterval,
      runSlowActivitiesEnabled,
    );

    this.runEveryXSeconds(
      'CHECK TRANSACTIONS COMPLETE',
      this.cronService.checkTransactionsComplete.bind(this.cronService),
      checkTransactionCompleteInterval,
      checkTransactionCompleteEnabled,
    );

    this.runEveryXSeconds(
      'CHECK TRANSACTIONS COMPLETE',
      this.cronService.cleanStuckAccounts.bind(this.cronService),
      cleanStuckAccountsInterval,
      cleanStuckAccountsEnabled,
    );
  }
}
