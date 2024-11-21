import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  AccountOnboard__factory,
  ERC20__factory,
  PrivateERC20__factory,
} from '../typechain-types';
import { EthersService } from './ethers.service';
import { getTransactionWithStatusNull } from '../entities';
import { TransactionReceipt } from 'ethers';

// import { PrivateERC721__factory } from 'coti-contracts/typechain-types/factories/contracts/token/PrivateERC721';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);
  private readonly privateErc20Interface =
    PrivateERC20__factory.createInterface();
  private readonly erc20Interface = ERC20__factory.createInterface();
  private readonly accountOnboardInterface =
    AccountOnboard__factory.createInterface();
  private readonly maxSyncBlocks: number;
  private readonly maxIndexBlocks: number;
  private readonly chainId: number;
  private readonly onBoardContractAddress: string;

  constructor(
    private readonly datasource: DataSource,
    private readonly configService: ConfigService,
    private readonly ethersService: EthersService,
  ) {}

  async checkTransactionsComplete() {
    const manager = this.datasource.manager;
    await manager.transaction(async (transactionManager: EntityManager) => {
      const take = 20;
      // find up to 10 transaction from db with no status
      const transactionsEntities = await getTransactionWithStatusNull(
        transactionManager,
        take,
      );
      this.logger.log(
        `[checkTransactionsComplete] found ${transactionsEntities.length}/${take} to handle`,
      );
      if (!transactionsEntities?.length) return;
      // request receipts
      const txHashToReceiptMap: Map<string, TransactionReceipt | null> =
        new Map<string, TransactionReceipt | null>();
      const receiptPromises = [];
      for (const tx of transactionsEntities) {
        receiptPromises.push(
          this.ethersService
            .getTransactionReceipt(tx.hash)
            .then((r) => txHashToReceiptMap.set(tx.hash, r)),
        );
      }
      await Promise.allSettled(receiptPromises);
      // fill fields
      // if transaction is 10 minutes old and dosent get any answer mark it with status 2
      for (const tx of transactionsEntities) {
        const receipt = txHashToReceiptMap.get(tx.hash);
        if (!receipt) {
          this.logger.log(
            `[checkTransactionsComplete] didnt find receipt for txHash ${tx.hash}`,
          );
          const nowMinus10Minutes = new Date();
          nowMinus10Minutes.setMinutes(nowMinus10Minutes.getMinutes() - 10);
          const transactionCreateTime = tx.createTime;
          if (transactionCreateTime < nowMinus10Minutes) {
            this.logger.log(
              `[checkTransactionsComplete] timeout to handle receipt for txHash ${tx.hash}`,
            );
            tx.status = 2;
          } else continue;
        }
        tx.status = receipt.status;
        tx.blockNumber = receipt.blockNumber;
        tx.gasUsed = receipt.gasUsed.toString();
        tx.index = receipt.index;
      }
      await transactionManager.save(transactionsEntities);
    });
  }

  async runActivities() {
    // TODO: complete this function
    // select all activities from the db
    // go over each activity and run it with all settled
    // currently we handle fill from faucet
    // onboard
    // send coti
  }
}
