import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { exec } from '@app/shared/utils';
import {
  CotiActivitiesEntity,
  CotiBlocksEntity,
  CotiTokensEntity,
  CotiTransactionsEntity,
  createCotiActivity,
  getAppStateByName,
  getCotiActivitiesByIds,
  getCotiBlockByIndex,
  getPopulatedCotiBlockByIndex,
  getTokensByAddresses,
  insertBlocksTransactions,
  insertLogs,
  saveNewCotiBlocks,
} from '@app/shared/entities/monitor';
import { AppStateNames } from '@app/shared/enums';
import { EthersService } from '@app/shared/services/ethers/ethers.service';
import { Block, JsonRpcProvider, Log, WebSocketProvider } from 'ethers';
import { AccountOnboard__factory, ERC20__factory, PrivateERC20__factory } from '@app/shared/typechain-types';
import { ZimzamMonitorEnvVariableNames } from '../types';
import { UserGateway } from '@app/shared/gateways/user.gateway';
import { CotiActivity } from '@app/shared/dtos/coti-activity.dto';
import { TransferEvent as PrivateERC20TransferEvent } from '@app/shared/typechain-types/PrivateERC20';
import { TransferEvent as ERC20TransferEvent } from '@app/shared/typechain-types/ERC20';
import { AccountOnboardedEvent } from '@app/shared/typechain-types/AccountOnboard';

// import { PrivateERC721__factory } from 'coti-contracts/typechain-types/factories/contracts/token/PrivateERC721';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);
  private readonly privateErc20Interface = PrivateERC20__factory.createInterface();
  private readonly erc20Interface = ERC20__factory.createInterface();
  private readonly accountOnboardInterface = AccountOnboard__factory.createInterface();
  private readonly maxSyncBlocks: number;
  private readonly maxIndexBlocks: number;
  private readonly chainId: number;
  private readonly onBoardContractAddress: string;

  constructor(
    private readonly datasource: DataSource,
    private readonly configService: ConfigService,
    private readonly ethersService: EthersService,
    private readonly userGateway: UserGateway,
  ) {
    this.chainId = configService.get<number>(ZimzamMonitorEnvVariableNames.COTI_CHAIN_ID);
    const providerUrl = configService.get<string>(ZimzamMonitorEnvVariableNames.COTI_RPC_URL);
    const wsProviderUrl = configService.get<string>(ZimzamMonitorEnvVariableNames.COTI_RPC_WEBSOCKET_URL);
    this.onBoardContractAddress = configService.get<string>(ZimzamMonitorEnvVariableNames.COTI_ONBOARD_CONTRACT_ADDRESS);
    this.maxSyncBlocks = configService.get<number>(ZimzamMonitorEnvVariableNames.COTI_MAX_SYNC_BLOCK);
    this.maxIndexBlocks = configService.get<number>(ZimzamMonitorEnvVariableNames.COTI_MAX_INDEX_BLOCK);

    ethersService.init(
      new Map([
        [
          this.chainId,
          {
            provider: new JsonRpcProvider(providerUrl),
            webSocketProvider: new WebSocketProvider(wsProviderUrl),
          },
        ],
      ]),
    );
  }

  async indexActivitiesWrapper(): Promise<void> {
    const manager = this.datasource.manager;
    let hasBlockGap = true;
    while (hasBlockGap) {
      const [appStateLatestIndexedBlockIndexError, appStateLatestIndexedBlockIndex] = await exec(getAppStateByName(manager, AppStateNames.COTI_LATEST_INDEXED_BLOCK, false));
      if (appStateLatestIndexedBlockIndexError) throw appStateLatestIndexedBlockIndexError;
      const [appStateLatestMonitoredBlockIndexError, appStateLatestMonitoredBlockIndex] = await exec(getAppStateByName(manager, AppStateNames.COTI_LATEST_MONITORED_BLOCK, false));
      if (appStateLatestMonitoredBlockIndexError) throw appStateLatestMonitoredBlockIndexError;
      const newBlockIndex = Number(appStateLatestIndexedBlockIndex.value) + 1;
      const latest = Number(appStateLatestMonitoredBlockIndex.value);
      if (latest < newBlockIndex) {
        hasBlockGap = false;
      } else {
        await this.indexActivities();
      }
    }
  }

  async indexActivities(): Promise<void> {
    const manager = this.datasource.manager;
    try {
      const dbTxResult = await manager.transaction(async transactionManager => {
        const [appStateLatestIndexedBlockNumberError, appStateLatestIndexedBlockNumber] = await exec(
          getAppStateByName(transactionManager, AppStateNames.COTI_LATEST_INDEXED_BLOCK, true),
        );
        if (appStateLatestIndexedBlockNumberError) throw appStateLatestIndexedBlockNumberError;
        const [appStateLatestMonitoredBlockIndexError, appStateLatestMonitoredBlockNumber] = await exec(
          getAppStateByName(transactionManager, AppStateNames.COTI_LATEST_MONITORED_BLOCK, false),
        );
        if (appStateLatestMonitoredBlockIndexError) throw appStateLatestMonitoredBlockIndexError;
        const currentBlockNumber = Number(appStateLatestIndexedBlockNumber.value);
        const nextBlockNumber = currentBlockNumber + 1;

        if (Number(appStateLatestMonitoredBlockNumber.value) < nextBlockNumber) {
          this.logger.log(`[indexActivities][No new block to handle]`);
          return;
        }
        let diffInBlocks = Number(appStateLatestMonitoredBlockNumber.value) - nextBlockNumber;
        diffInBlocks = diffInBlocks > this.maxIndexBlocks ? this.maxIndexBlocks : diffInBlocks;
        const newBlocks: CotiBlocksEntity[] = await getPopulatedCotiBlockByIndex(transactionManager, nextBlockNumber, nextBlockNumber + diffInBlocks);
        if (!newBlocks.length) {
          this.logger.error(`[indexActivities][Block not found]`);
          return;
        }
        const newActivitiesPromises: Promise<CotiActivitiesEntity[]>[] = [];
        for (const block of newBlocks) {
          newActivitiesPromises.push(this.handleBlockTransactionsActivities(transactionManager, block));
        }
        const newActivitiesResult = await Promise.allSettled<CotiActivitiesEntity[]>(newActivitiesPromises);
        const successfullyNewActivities = newActivitiesResult
          .filter(x => x.status === 'fulfilled')
          .map(x => x.value)
          .flat(1)
          .sort((a, b) => a.blockId - b.blockId);
        const failedNewTokensActivities = newActivitiesResult.filter(x => x.status === 'rejected');
        if (failedNewTokensActivities.length > 0) {
          throw new Error('Failed to retrieve activities');
        }
        await manager.insert(CotiActivitiesEntity, successfullyNewActivities);
        this.logger.log(`[indexActivities][Inserted ${successfullyNewActivities.length} activities from block ${nextBlockNumber} to block ${nextBlockNumber + diffInBlocks}]`);

        appStateLatestIndexedBlockNumber.value = (nextBlockNumber + diffInBlocks).toString();
        await transactionManager.save(appStateLatestIndexedBlockNumber);
        this.logger.log(`[indexActivities][Saved new app state ${AppStateNames.COTI_LATEST_INDEXED_BLOCK} ${appStateLatestIndexedBlockNumber.value}]`);
        return { successfullyNewActivities, diffInBlocks };
      });
      const { successfullyNewActivities, diffInBlocks } = dbTxResult;
      if (successfullyNewActivities?.length && diffInBlocks < 10) {
        const populatedActivities = await getCotiActivitiesByIds(
          manager,
          successfullyNewActivities.map(x => x.id),
        );
        for (const activity of populatedActivities) {
          const tokenAddress = activity.token?.address;

          let fromRoomName = `address_${this.chainId}_${activity.from.toLowerCase()}`;
          if (tokenAddress) {
            fromRoomName += `_${tokenAddress.toLowerCase()}`;
          }
          this.userGateway.sendMessageToRoom(fromRoomName, 'New Activity', new CotiActivity(activity));

          let toRoomName = `address_${this.chainId}_${activity.to.toLowerCase()}`;
          if (tokenAddress) {
            toRoomName += `_${tokenAddress.toLowerCase()}`;
          }
          this.userGateway.sendMessageToRoom(toRoomName, 'New Activity', new CotiActivity(activity));
        }
      }
    } catch (error) {
      this.logger.error(`[indexActivities][${error}]`);
    }
  }

  async handleBlockTransactionsActivities(manager: EntityManager, block: CotiBlocksEntity): Promise<CotiActivitiesEntity[]> {
    const activities: CotiActivitiesEntity[] = [];
    const transactions = block.transactions;
    if (transactions?.length) {
      const possibleTokensAddresses: string[] = transactions.reduce((acc, cur) => [...acc, ...cur.logs.map(l => l.address)], []);
      const tokens = await getTokensByAddresses(manager, possibleTokensAddresses);
      const existingTokensMap: { [address: string]: CotiTokensEntity } = tokens.reduce((prev, cur) => {
        prev[cur.address] = cur;
        return prev;
      }, {});
      for (const transaction of transactions) {
        if (transaction.data === '0x') {
          const activity = createCotiActivity(manager, block, transaction, 'cotiTransfer', JSON.stringify(transaction.value), null, null, transaction.from, transaction.to);
          activities.push(activity);
        } else {
          let supportedActivity = false;
          const logs = transaction.logs;
          if (logs?.length) {
            for (const log of logs) {
              const data = log.data;
              const topics = JSON.parse(log.topics);
              const contractAddress = log.address;
              if (contractAddress == this.onBoardContractAddress) {
                supportedActivity = true;
                const parsedLog = this.accountOnboardInterface.parseLog({
                  topics,
                  data,
                }) as unknown as AccountOnboardedEvent.LogDescription;

                const eventData = {
                  userKey1: parsedLog.args.userKey1,
                  userKey2: parsedLog.args.userKey2,
                };
                const activity = createCotiActivity(manager, block, transaction, 'accountOnboard', JSON.stringify(eventData), log.index, null, transaction.from, transaction.to);
                activities.push(activity);
              } else {
                const token = existingTokensMap[contractAddress];
                if (token) {
                  supportedActivity = true;
                  if (token.isPrivate) {
                    const parsedLog = this.privateErc20Interface.parseLog({
                      topics,
                      data,
                    }) as unknown as PrivateERC20TransferEvent.LogDescription;
                    if (parsedLog?.name === 'Transfer') {
                      const from = parsedLog.args.from;
                      const to = parsedLog.args.to;
                      const eventData = {
                        from,
                        to,
                        senderValue: parsedLog.args.senderValue,
                        receiverValue: parsedLog.args.receiverValue,
                      };
                      const activity = createCotiActivity(manager, block, transaction, 'privateTokenTransfer', JSON.stringify(eventData), log.index, token.id, from, to);
                      activities.push(activity);
                    }
                  } else {
                    const parsedLog = this.erc20Interface.parseLog({
                      topics,
                      data,
                    }) as unknown as ERC20TransferEvent.LogDescription;
                    if (parsedLog?.name === 'Transfer') {
                      const from = parsedLog.args.from;
                      const to = parsedLog.args.to;
                      const eventData = {
                        from,
                        to,
                        value: parsedLog.args.value,
                      };
                      const activity = createCotiActivity(manager, block, transaction, 'tokenTransfer', JSON.stringify(eventData), log.index, token.id, from, to);
                      activities.push(activity);
                    }
                  }
                }
              }
            }
          }
          if (!supportedActivity) {
            const activity = createCotiActivity(
              manager,
              block,
              transaction,
              'contractInteraction',
              JSON.stringify(transaction.value),
              null,
              null,
              transaction.from,
              transaction.to,
            );
            activities.push(activity);
          }
        }
      }
    }
    return activities;
  }

  async monitorInBlockCotiTransactionsWrapper(): Promise<void> {
    const manager = this.datasource.manager;
    let hasBlockGap = true;
    while (hasBlockGap) {
      const [appStateLatestMonitoredBlockNumberError, appStateLatestMonitoredBlockNumber] = await exec(
        getAppStateByName(manager, AppStateNames.COTI_LATEST_MONITORED_BLOCK, false),
      );
      if (appStateLatestMonitoredBlockNumberError) throw appStateLatestMonitoredBlockNumberError;
      const nextBlockNumber = Number(appStateLatestMonitoredBlockNumber.value) + 1;
      const latestBlock = await this.ethersService.getLatestBlock();
      if (latestBlock.number < nextBlockNumber) {
        hasBlockGap = false;
      } else {
        await this.monitorInBlockCotiTransactions();
      }
    }
  }

  async isBlockHashMatch(manager: EntityManager, currentBlockIdx: number, block: Block): Promise<boolean> {
    const [blockEntityError, blockEntity] = await exec(getCotiBlockByIndex(manager, currentBlockIdx));
    if (blockEntityError) throw blockEntityError;
    // In case of first block in the system
    if (!blockEntity) return true;
    return blockEntity.hash === block.parentHash;
  }

  async monitorInBlockCotiTransactions(): Promise<void> {
    const manager = this.datasource.manager;
    try {
      await manager.transaction(async transactionManager => {
        const [appStateBlockEntityError, appStateLatestMonitoredBlockNumber] = await exec(getAppStateByName(transactionManager, AppStateNames.COTI_LATEST_MONITORED_BLOCK, true));
        if (appStateBlockEntityError) throw appStateBlockEntityError;

        const currentBlockNumber = Number(appStateLatestMonitoredBlockNumber.value);
        const nextBlockNumber = currentBlockNumber + 1;
        const latestBlock = await this.ethersService.getLatestBlock();
        const latestBlockNumber = Number(latestBlock.number);
        if (latestBlockNumber < nextBlockNumber) {
          this.logger.log(`[monitorInBlockCotiTransactions][No new block to handle]`);
          return;
        }
        const diffBlocks = latestBlockNumber - currentBlockNumber;
        const blocksWorkingRange = diffBlocks > this.maxSyncBlocks ? this.maxSyncBlocks : diffBlocks;
        const maxBlockNumber = currentBlockNumber + blocksWorkingRange;
        const blocks = await this.ethersService.getBlockRange(nextBlockNumber, maxBlockNumber, true);
        const blocksEntities = await saveNewCotiBlocks(transactionManager, blocks);
        const blocksTransactionHashes = blocks.reduce((prev: string[], cur) => [...prev, ...cur.transactions], []);
        if (blocksTransactionHashes.length) {
          const transactionsReceiptMap = await this.ethersService.getTransactionsReceipt(blocksTransactionHashes);
          const transactions = await insertBlocksTransactions(transactionManager, blocks, blocksEntities, transactionsReceiptMap);
          const logs = await this.ethersService.getLogs({
            fromBlock: nextBlockNumber,
            toBlock: maxBlockNumber,
          });
          if (logs.length) {
            const transactionHashToTransactionEntityMap = new Map<string, CotiTransactionsEntity>();
            for (const transaction of transactions) {
              transactionHashToTransactionEntityMap.set(transaction.hash, transaction);
            }
            const logsEntities = await insertLogs(transactionManager, logs, transactionHashToTransactionEntityMap);

            const logsAddresses = logsEntities.map(logsEntity => logsEntity.address);
            const tokens = await getTokensByAddresses(transactionManager, logsAddresses);
            const existingTokensMap = tokens.reduce((prev, cur) => {
              prev[cur.address] = cur;
              return prev;
            }, {});
            const newPossibleTokensMap = {};
            const handleNewPossibleTokensPromises: Promise<CotiTokensEntity>[] = [];
            for (const log of logs) {
              if (existingTokensMap[log.address] || newPossibleTokensMap[log.address]) continue;
              handleNewPossibleTokensPromises.push(this.handleNewPossibleToken(transactionManager, log));
              newPossibleTokensMap[log.address] = true;
            }
            const newTokens = await Promise.allSettled<CotiTokensEntity>(handleNewPossibleTokensPromises);
            const successfullyNewTokens = newTokens.filter(x => x.status === 'fulfilled');
            const failedNewTokens = newTokens.filter(x => x.status === 'rejected');
            for (const newToken of successfullyNewTokens) {
              if (newToken.value) this.logger.log(`[monitorInBlockCotiTransactions][Token name: ${newToken.value.name} token address: ${newToken.value.address}]`);
            }
            for (const newToken of failedNewTokens) {
              this.logger.error(`[monitorInBlockCotiTransactions][Failed insertion of token; reason: ${newToken.reason}]`);
            }
          }
        }

        appStateLatestMonitoredBlockNumber.value = maxBlockNumber.toString();
        await transactionManager.save(appStateLatestMonitoredBlockNumber);
        this.logger.log(`[monitorInBlockCotiTransactions][Saved new app state ${AppStateNames.COTI_LATEST_MONITORED_BLOCK} ${maxBlockNumber}]`);
      });
    } catch (error) {
      this.logger.error(`[monitorInBlockCotiTransactions][${error}]`);
    }
  }

  async handleNewPossibleToken(manager: EntityManager, log: Log): Promise<CotiTokensEntity> {
    try {
      // const privateErc721Interface = PrivateERC721__factory.createInterface();
      // event Transfer(address indexed from, address indexed to, ctUint64 senderValue, ctUint64 receiverValue);
      // event Transfer(address indexed from, address indexed to, uint256 value);
      const transferLogPrivate = this.privateErc20Interface.parseLog(log);
      const transferLog = this.erc20Interface.parseLog(log);
      const properties: { name: string; decimals: bigint; symbol: string } = { name: '', decimals: 0n, symbol: '' };
      const propertiesPromises = [];
      if (transferLog?.name === 'Transfer') {
        const erc20 = ERC20__factory.connect(log.address, this.ethersService.getProvider());

        propertiesPromises.push(erc20.decimals().then(x => (properties.decimals = x)));
        propertiesPromises.push(erc20.name().then(x => (properties.name = x)));
        propertiesPromises.push(erc20.symbol().then(x => (properties.symbol = x)));
        propertiesPromises.push(erc20['balanceOf(address)'](log.address));
        await Promise.all(propertiesPromises);
        const tokenEntity = manager.create(CotiTokensEntity, {
          decimals: properties.decimals.toString(),
          address: log.address,
          name: properties.name,
          symbol: properties.symbol,
          isPrivate: false,
        });
        return manager.save(tokenEntity);
      } else if (transferLogPrivate?.name === 'Transfer') {
        const privateERC20 = PrivateERC20__factory.connect(log.address, this.ethersService.getProvider());
        propertiesPromises.push(privateERC20.decimals().then(x => (properties.decimals = x)));
        propertiesPromises.push(privateERC20.name().then(x => (properties.name = x)));
        propertiesPromises.push(privateERC20.symbol().then(x => (properties.symbol = x)));
        propertiesPromises.push(privateERC20['balanceOf(address)'](log.address));
        await Promise.all(propertiesPromises);
        const tokenEntity = manager.create(CotiTokensEntity, {
          decimals: properties.decimals.toString(),
          address: log.address,
          name: properties.name,
          symbol: properties.symbol,
          isPrivate: true,
        });
        return manager.save(tokenEntity);
      }
    } catch (error) {
      this.logger.warn(`Failed to handle contract with address ${log.address}`);
    }
  }
}
