import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  AccountOnboard__factory,
  ERC20__factory,
  PrivateERC20__factory,
} from '../typechain-types';
import { EthersService } from './ethers.service';
import {
  ActionsEntity,
  getAccountsByIndexes,
  getAccountsToOnboard,
  getAllActions,
  getTransactionWithStatusNull,
} from '../entities';
import { formatEther, TransactionReceipt } from 'ethers';
import { ActionEnum } from '../enums/action.enum';
import { AppService } from '../app.service';

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
    private readonly appService: AppService,
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
    const manager = this.datasource.manager;
    const actions = await getAllActions(manager);
    const filteredActions = actions.filter((x) => x.randomRange > 0);
    console.table(filteredActions, ['type', 'randomRange']);
    const actionPromises = [];
    if (filteredActions.length === 0) return;
    for (const action of filteredActions) {
      switch (action.type) {
        case ActionEnum.CreateAccount:
          actionPromises.push(this.handleCreateAccount(action));
          break;
        case ActionEnum.SendCoti:
          actionPromises.push(this.handleSendCoti(action));
          break;
        case ActionEnum.OnboardAccount:
          actionPromises.push(this.handleOnboardAccount(action));
          break;
      }
    }

    await Promise.allSettled(actionPromises);

    // select all activities from the db
    // go over each activity and run it with all settled
    // currently we handle fill from faucet
    // onboard
    // send coti
  }

  async handleCreateAccount(action: ActionsEntity) {
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(
      `[runActivities][handleCreateAccount] activityCount/randomRange ${activityCount}/${randomRange}`,
    );
    if (activityCount === 0) return;
    for (let i = 0; i < activityCount; i++) {
      await this.appService.createAccount();
    }
  }
  async handleSendCoti(action: ActionsEntity) {
    const manager = this.datasource.manager;
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(
      `[runActivities][handleSendCoti] activityCount/randomRange ${activityCount}/${randomRange}`,
    );
    if (activityCount === 0) return;
    const accountIndexesRes =
      await this.appService.pickRandomAccountsToSendCoti({
        count: activityCount,
      });

    const accounts = await getAccountsByIndexes(
      manager,
      accountIndexesRes.accountsIndexes,
    );
    const balanceMap = await this.ethersService.getBalances(
      accounts.map((a) => a.address),
    );
    const sendingCotiPromises = [];

    while (accounts.length) {
      const sendingAccount = accounts.pop();
      const receivingAccount = accounts.pop();
      const sendingAccountBalance = balanceMap.get(sendingAccount.address);
      if (sendingAccountBalance === 0n) continue;
      // TODO: make it dynamic
      const amount = formatEther((sendingAccountBalance / 10n).toString());
      sendingCotiPromises.push(
        this.appService.sendCotiFromAccountToAccount({
          fromIndex: sendingAccount.index,
          toIndex: receivingAccount.index,
          amountInCoti: amount.toString(),
        }),
      );
    }
    await Promise.allSettled(sendingCotiPromises);
  }

  async handleOnboardAccount(action: ActionsEntity) {
    const manager = this.datasource.manager;
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(
      `[runActivities][handleOnboardAccount] activityCount/randomRange ${activityCount}/${randomRange}`,
    );
    if (activityCount === 0) return;
    const onboardPromises = [];
    const accountsToOnboard = await getAccountsToOnboard(
      manager,
      activityCount,
    );
    for (const account of accountsToOnboard) {
      onboardPromises.push(
        this.appService.onboardAccount({ index: account.index }),
      );
    }
    await Promise.allSettled(onboardPromises);
  }
}
