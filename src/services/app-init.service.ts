import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppStateNames } from '@app/shared/enums';
import { exec, sleep } from '@app/shared/utils';
import { CronService } from './cron.service';
import moment from 'moment';
import { ZimzamMonitorEnvVariableNames } from '../types';
import { DataSource } from 'typeorm';
import { TableNames } from '@app/shared/entities';
import { AppStatesEntity } from '@app/shared/entities/monitor';

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
      const [appStatesError, appStates] = await exec(manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).find());
      if (appStatesError) throw new InternalServerErrorException(appStatesError);

      const appStateArr = [];
      if (!appStates.find(appState => appState.name === AppStateNames.COTI_LATEST_MONITORED_BLOCK)) {
        appStateArr.push(
          manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).create({
            name: AppStateNames.COTI_LATEST_MONITORED_BLOCK,
            value: '0',
          }),
        );
      }

      if (!appStates.find(appState => appState.name === AppStateNames.COTI_LATEST_INDEXED_BLOCK)) {
        appStateArr.push(
          manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).create({
            name: AppStateNames.COTI_LATEST_INDEXED_BLOCK,
            value: '0',
          }),
        );
      }

      if (appStateArr.length > 0) {
        const [appStateError] = await exec(manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).save(appStateArr));
        if (appStateError) throw new InternalServerErrorException(appStateError);
      }

      return;
    } catch (error) {
      this.logger.error('[initAppStateOnDB]', error);
      throw error;
    }
  }

  async runEveryXSeconds(name: string, functionToRun: () => Promise<any>, minIntervalInSeconds: number, enable: boolean) {
    if (!enable) return;
    try {
      let lastActivationTime: number;
      iterationCounter.set(name, 1);
      while (true) {
        this.logger.log(`Task [${name}][iteration ${iterationCounter.get(name)}] started`);
        lastActivationTime = moment.now();
        const [error] = await exec(functionToRun());
        if (error) this.logger.error(`Task [${name}][iteration ${iterationCounter.get(name)}] [${error.message || error}]`);
        this.logger.log(`Task [${name}][iteration ${iterationCounter.get(name)}] ended`);

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
    const monitorBlockInterval = this.configService.get<number>(ZimzamMonitorEnvVariableNames.MONITOR_BLOCK_INTERVAL_IN_SECONDS);
    const monitorBlockEnable = this.configService.get<boolean>(ZimzamMonitorEnvVariableNames.MONITOR_BLOCK_ENABLED);

    const indexActivitiesInterval = this.configService.get<number>(ZimzamMonitorEnvVariableNames.INDEX_ACTIVITIES_INTERVAL_IN_SECONDS);
    const indexActivitiesEnable = this.configService.get<boolean>(ZimzamMonitorEnvVariableNames.INDEX_ACTIVITIES_ENABLED);

    this.runEveryXSeconds('MONITOR BLOCKS', this.cronService.monitorInBlockCotiTransactionsWrapper.bind(this.cronService), monitorBlockInterval, monitorBlockEnable);
    this.runEveryXSeconds('INDEX ACTIVITIES', this.cronService.indexActivitiesWrapper.bind(this.cronService), indexActivitiesInterval, indexActivitiesEnable);
  }
}
