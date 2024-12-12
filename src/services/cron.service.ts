import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataSource,
  EntityManager,
  FindManyOptions,
  FindOptionsWhere,
} from 'typeorm';
import { EthersService } from './ethers.service';
import {
  AccountsEntity,
  ActionsEntity,
  findTokens,
  getAccountIndexesThatReceiveToken,
  getAccountsByIds,
  getAccountsByIndexes,
  getAccountsNonce,
  getAccountsToOnboard,
  getAllActions,
  getLastHourActivityPerAction,
  getTokensCount,
  getTransactionWithStatusNull,
  isThereVerifiedTransactionInTheLast5Min,
  TokensEntity,
} from '../entities';
import { formatEther, TransactionReceipt, TransactionResponse } from 'ethers';
import { ActionEnum } from '../enums/action.enum';
import { AppService } from '../app.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

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
        `[checkTransactionsComplete][Found ${transactionsEntities.length}/${take} to handle]`,
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
      // if transaction is 10 minutes old and doesn't get any answer mark it with status 2
      for (const tx of transactionsEntities) {
        const receipt = txHashToReceiptMap.get(tx.hash);
        if (!receipt) {
          this.logger.warn(
            `[checkTransactionsComplete][Didnt find receipt for txHash ${tx.hash}]`,
          );
          const nowMinus10Minutes = new Date();
          nowMinus10Minutes.setMinutes(nowMinus10Minutes.getMinutes() - 10);
          const transactionCreateTime = tx.createTime;
          if (transactionCreateTime < nowMinus10Minutes) {
            this.logger.warn(
              `[checkTransactionsComplete][Timeout to handle receipt for txHash ${tx.hash}]`,
            );
            tx.status = 2;
          }
        } else {
          tx.status = receipt.status;
          tx.blockNumber = receipt.blockNumber;
          tx.gasUsed = receipt.gasUsed.toString();
          tx.index = receipt.index;
          if (receipt.gasPrice) tx.gasPrice = receipt.gasPrice.toString();
        }
      }
      await transactionManager.save(transactionsEntities);
    });
  }

  async runActivities(): Promise<void> {
    const manager = this.datasource.manager;
    const isNetworkActive = isThereVerifiedTransactionInTheLast5Min(manager);
    if (!isNetworkActive) {
      this.logger.warn(`The network is stuck`);
      return;
    }
    const actions = await getAllActions(manager);
    const lastHourActivityPerActionMap =
      await getLastHourActivityPerAction(manager);
    const extendedActions: (ActionsEntity & {
      lastHourActivityCount: number;
    })[] = actions.map((x) => ({
      ...x,
      lastHourActivityCount: lastHourActivityPerActionMap.get(x.type) || 0,
    }));

    console.table(extendedActions, [
      'type',
      'randomRange',
      'maxPerHour',
      'lastHourActivityCount',
    ]);
    const filteredActions = extendedActions.filter(
      (x) => x.randomRange > 0 && x.lastHourActivityCount < x.maxPerHour,
    );
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
        case ActionEnum.SendCotiFromFaucet:
          actionPromises.push(this.handleSendCotiFromFaucet(action));
          break;
      }
    }

    await Promise.allSettled(actionPromises);
  }

  async runSlowActivities(): Promise<void> {
    const manager = this.datasource.manager;
    const isNetworkActive = isThereVerifiedTransactionInTheLast5Min(manager);
    if (!isNetworkActive) {
      this.logger.warn(`The network is stuck`);
      return;
    }
    const actions = await getAllActions(manager);
    const lastHourActivityPerActionMap =
      await getLastHourActivityPerAction(manager);
    const extendedActions: (ActionsEntity & {
      lastHourActivityCount: number;
    })[] = actions.map((x) => ({
      ...x,
      lastHourActivityCount: lastHourActivityPerActionMap.get(x.type) || 0,
    }));

    console.table(extendedActions, [
      'type',
      'randomRange',
      'maxPerHour',
      'lastHourActivityCount',
    ]);
    const filteredActions = extendedActions.filter(
      (x) => x.randomRange > 0 && x.lastHourActivityCount < x.maxPerHour,
    );
    const actionPromises = [];
    if (filteredActions.length === 0) return;
    for (const action of filteredActions) {
      switch (action.type) {
        case ActionEnum.MintPrivateToken:
          actionPromises.push(this.handleMintToken(action));
          break;
        case ActionEnum.MintToken:
          actionPromises.push(this.handleMintToken(action));
          break;

        case ActionEnum.TransferPrivateToken:
          actionPromises.push(this.handleTransferToken(action));
          break;
        case ActionEnum.TransferToken:
          actionPromises.push(this.handleTransferToken(action));
          break;
        case ActionEnum.CreateToken:
          actionPromises.push(this.handleCreateToken(action));
          break;
        case ActionEnum.CreatePrivateToken:
          actionPromises.push(this.handleCreateToken(action));
          break;
      }
    }

    await Promise.allSettled(actionPromises);
  }

  async handleCreateAccount(action: ActionsEntity) {
    // TODO: handle faucet protection
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(
      `[runActivities][handleCreateAccount][activityCount/randomRange ${activityCount}/${randomRange}]`,
    );
    if (activityCount === 0) return;
    for (let i = 0; i < activityCount; i++) {
      await this.appService.createAccount();
    }
    this.logger.log(
      `[runActivities][handleCreateAccount][${activityCount} created account]`,
    );
  }

  async isStuckAccounts(
    manager: EntityManager,
    indexes: number[],
  ): Promise<Map<number, boolean>> {
    const isStuckMap = new Map<number, boolean>();
    // get latest nonce in the transaction and latest confirmed nonce
    const nonceMap = await getAccountsNonce(manager, indexes);
    for (const [key, value] of nonceMap) {
      isStuckMap.set(
        key,
        value.maxCompletedNonce + 1 <
          Math.max(value.maxStuckNonce, value.maxPendingNonce),
      );
    }
    return isStuckMap;
  }
  async handleSendCoti(action: ActionsEntity) {
    const manager = this.datasource.manager;
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(
      `[runActivities][handleSendCoti][activityCount/randomRange ${activityCount}/${randomRange}]`,
    );
    if (activityCount === 0) return;
    const accountIndexesRes =
      await this.appService.pickRandomAccountsToSendCoti({
        count: activityCount,
      });

    let accounts = await getAccountsByIndexes(
      manager,
      accountIndexesRes.accountsIndexes,
    );

    const stuckMap = await this.isStuckAccounts(
      manager,
      accounts.map((x) => x.index),
    );
    let isStuckAccounts = false;
    for (const account of accounts) {
      const isStuck = stuckMap.get(account.index);
      if (isStuck) {
        isStuckAccounts = true;
        account.isStuck = true;
      }
    }
    if (isStuckAccounts) {
      await manager.save(accounts);
      accounts = accounts.filter((x) => !x.isStuck);
      if (accounts.length % 2 !== 0) accounts.pop();
    }

    const balanceMap = await this.ethersService.getBalances(
      accounts.map((a) => a.address),
    );
    const sendingCotiPromises = [];

    while (accounts.length) {
      const firstAccount = accounts.pop();
      const secondAccount = accounts.pop();
      const firstAccountBalance = balanceMap.get(firstAccount.address);
      const secondAccountBalance = balanceMap.get(secondAccount.address);
      let sendingAccount: AccountsEntity;
      let receivingAccount: AccountsEntity;
      if (firstAccountBalance >= secondAccountBalance) {
        sendingAccount = firstAccount;
        receivingAccount = secondAccount;
      } else {
        sendingAccount = secondAccount;
        receivingAccount = firstAccount;
      }
      const sendingAccountBalance = balanceMap.get(sendingAccount.address);
      if (sendingAccountBalance === 0n) continue;
      // TODO: make it dynamic
      const balanceToSend = this.replaceLessSignificantDigits(
        sendingAccountBalance / 10n,
        9,
      );
      if (balanceToSend === 0n) return;
      const amount = formatEther(balanceToSend).toString();
      sendingCotiPromises.push(
        this.appService.sendCotiFromAccountToAccount({
          fromIndex: sendingAccount.index,
          toIndex: receivingAccount.index,
          amountInCoti: amount.toString(),
        }),
      );
    }
    await Promise.allSettled(sendingCotiPromises);
    this.logger.log(
      `[runActivities][handleSendCoti][${activityCount} tx(s) sent coti]`,
    );
  }

  async handleOnboardAccount(action: ActionsEntity) {
    const manager = this.datasource.manager;
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(
      `[runActivities][handleOnboardAccount][activityCount/randomRange ${activityCount}/${randomRange}]`,
    );
    if (activityCount === 0) return;
    const onboardPromises = [];
    let accountsToOnboard = await getAccountsToOnboard(manager, activityCount);
    const stuckMap = await this.isStuckAccounts(
      manager,
      accountsToOnboard.map((x) => x.index),
    );
    let isStuckAccounts = false;
    for (const account of accountsToOnboard) {
      const isStuck = stuckMap.get(account.index);
      if (isStuck) {
        isStuckAccounts = true;
        account.isStuck = true;
      }
    }
    if (isStuckAccounts) {
      await manager.save(accountsToOnboard);
      accountsToOnboard = accountsToOnboard.filter((x) => !x.isStuck);
    }
    for (const account of accountsToOnboard) {
      onboardPromises.push(
        this.appService.onboardAccount({ index: account.index }),
      );
    }
    await Promise.allSettled(onboardPromises);
    this.logger.log(
      `[runActivities][handleOnboardAccount][${activityCount} tx(s) onboarded account]`,
    );
  }

  async handleSendCotiFromFaucet(action: ActionsEntity) {
    // TODO: implement faucet protection
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(
      `[runActivities][handleSendCotiFromFaucet][activityCount/randomRange ${activityCount}/${randomRange}]`,
    );
    if (activityCount === 0) return;
    const accountIndexesRes = await this.appService.pickRandomAccountsToRefill({
      count: activityCount,
    });
    const sendingCotiPromises = [];
    for (const index of accountIndexesRes.accountsIndexes) {
      const refillAmount = Math.random().toFixed(2);
      sendingCotiPromises.push(
        this.appService.sendCotiFromFaucet({
          toIndex: index,
          amountInCoti: refillAmount.toString(),
        }),
      );
    }
    await Promise.allSettled(sendingCotiPromises);
    this.logger.log(
      `[runActivities][handleSendCotiFromFaucet][${activityCount} tx(s) sent coti from faucet]`,
    );
  }

  async handleCreateToken(action: ActionsEntity) {
    const manager = this.datasource.manager;
    // TODO: implement faucet protection
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    const isPrivate = action.type === ActionEnum.CreatePrivateToken;
    this.logger.log(
      `[runSlowActivities][handleCreateToken][${isPrivate ? 'private' : 'not private'}][activityCount/randomRange ${activityCount}/${randomRange}]`,
    );
    if (activityCount === 0) return;
    const accountIndexesRes = await this.appService.pickRandomAccountsToRefill({
      count: activityCount,
    });
    let accounts = await getAccountsByIndexes(
      manager,
      accountIndexesRes.accountsIndexes,
    );
    const stuckMap = await this.isStuckAccounts(
      manager,
      accounts.map((x) => x.index),
    );
    let isStuckAccounts = false;
    for (const account of accounts) {
      const isStuck = stuckMap.get(account.index);
      if (isStuck) {
        isStuckAccounts = true;
        account.isStuck = true;
      }
    }
    if (isStuckAccounts) {
      await manager.save(accounts);
      accounts = accounts.filter((x) => !x.isStuck);
    }
    const accountIndexes = accounts.map((x) => x.index);
    const createTokenPromises = [];
    for (const accountIndex of accountIndexes) {
      createTokenPromises.push(
        this.createTokenWrapper(accountIndex, isPrivate),
      );
    }
    await Promise.allSettled(createTokenPromises);
    this.logger.log(
      `[runSlowActivities][handleCreateToken][${isPrivate ? 'private' : 'not private'}][${activityCount} tx(s) created token]`,
    );
  }

  async createTokenWrapper(accountIndex: number, isPrivate: boolean) {
    const refillTx = await this.appService.sendCotiFromFaucet({
      toIndex: accountIndex,
      amountInCoti: '5',
    });
    await refillTx.wait();

    await this.appService.createNewToken({
      accountIndex,
      isPrivate,
      isBusiness: false,
      decimals: 9,
    });
  }

  async handleMintToken(action: ActionsEntity) {
    const manager = this.datasource.manager;
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    const isPrivate = action.type === ActionEnum.MintPrivateToken;
    this.logger.log(
      `[runSlowActivities][handleMintToken][${isPrivate ? 'private' : 'not private'}][activityCount/randomRange ${activityCount}/${randomRange}]`,
    );
    if (activityCount === 0) return;
    const accountIndexesRes = await this.appService.pickRandomAccountsToRefill({
      count: activityCount,
    });
    const findOptions: FindOptionsWhere<TokensEntity> = { isPrivate };
    // get activity count tokens
    const tokensCount = await getTokensCount(manager, findOptions);
    if (tokensCount === 0) return;
    const randomSkip =
      activityCount >= tokensCount
        ? 0
        : Math.round(Math.random() * (tokensCount - activityCount));
    const findManyOptions: FindManyOptions<TokensEntity> = {
      where: findOptions,
      skip: randomSkip,
      take: activityCount,
    };
    let tokens = await findTokens(manager, findManyOptions);
    const tokensOwnerIds = tokens.map((t) => t.ownerAccountId);
    let accounts = await getAccountsByIds(manager, tokensOwnerIds);
    const stuckMap = await this.isStuckAccounts(
      manager,
      accounts.map((x) => x.index),
    );
    let isStuckAccounts = false;
    for (const account of accounts) {
      const isStuck = stuckMap.get(account.index);
      if (isStuck) {
        isStuckAccounts = true;
        account.isStuck = true;
      }
    }
    if (isStuckAccounts) {
      await manager.save(accounts);
      accounts = accounts.filter((x) => !x.isStuck);
    }
    tokens = tokens.filter((t) =>
      accounts.find((a) => a.id === t.ownerAccountId),
    );
    // send for each token
    const mintTokenPromises = [];
    for (const token of tokens) {
      const toIndex = accountIndexesRes.accountsIndexes.pop();
      const mintAmount =
        BigInt(Math.round(Math.random() * 1000)) *
        10n ** BigInt(token.decimals);
      mintTokenPromises.push(
        this.appService.mintToken({
          tokenId: token.id,
          toIndex,
          tokenAmountInWei: mintAmount.toString(),
        }),
      );
    }
    await Promise.allSettled(mintTokenPromises);
    this.logger.log(
      `[runSlowActivities][handleMintToken][${isPrivate ? 'private' : 'not private'}][${activityCount} tx(s) minted token]`,
    );
  }

  async handleTransferToken(action: ActionsEntity) {
    const manager = this.datasource.manager;
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    const isPrivate = action.type === ActionEnum.TransferPrivateToken;
    this.logger.log(
      `[runSlowActivities][handleTransferToken][${isPrivate ? 'private' : 'not private'}][activityCount/randomRange ${activityCount}/${randomRange}]`,
    );
    if (activityCount === 0) return;
    const findOptions: FindOptionsWhere<TokensEntity> = { isPrivate };
    // get activity count tokens
    const tokensCount = await getTokensCount(manager, findOptions);
    if (tokensCount === 0) return;
    const randomSkip =
      activityCount >= tokensCount
        ? 0
        : Math.round(Math.random() * (tokensCount - activityCount));
    const findManyOptions: FindManyOptions<TokensEntity> = {
      where: findOptions,
      skip: randomSkip,
      take: activityCount,
    };
    const tokens = await findTokens(manager, findManyOptions);
    // send for each token
    const transferTokenPromises = [];
    for (const token of tokens) {
      transferTokenPromises.push(this.sendTokenWrapper(token));
    }
    await Promise.allSettled(transferTokenPromises);
    this.logger.log(
      `[runSlowActivities][handleTransferToken][${isPrivate ? 'private' : 'not private'}][${activityCount} tx(s) transferred token]`,
    );
  }

  async sendTokenWrapper(token: TokensEntity): Promise<TransactionResponse> {
    const manager = this.datasource.manager;
    // pick 1 account with affiliation to the token
    const accountsIndexThatReceivedToken =
      await getAccountIndexesThatReceiveToken(manager, token.id);
    const randomIndex =
      accountsIndexThatReceivedToken[
        Math.round(Math.random() * (accountsIndexThatReceivedToken.length - 1))
      ];
    if (randomIndex === null) return;
    // pick 1 random account
    const accountToIndexRes = await this.appService.pickRandomAccountsToRefill({
      count: 1,
      banIndexList: [randomIndex],
    });
    const accounts = await getAccountsByIndexes(manager, [
      randomIndex,
      accountToIndexRes.accountsIndexes[0],
    ]);
    const stuckMap = await this.isStuckAccounts(
      manager,
      accounts.map((x) => x.index),
    );
    let isStuckAccounts = false;
    for (const account of accounts) {
      const isStuck = stuckMap.get(account.index);
      if (isStuck) {
        isStuckAccounts = true;
        account.isStuck = true;
      }
    }
    if (isStuckAccounts) {
      await manager.save(accounts);
      return;
    }
    const fromAccount = accounts.find((x) => x.index === randomIndex);

    const toAccount = accounts.find((x) => x.index !== randomIndex);
    // get balances
    let bigintBalance = await this.ethersService.getErc20Balance(
      token.address,
      fromAccount.address,
      token.isPrivate,
    );
    if (token.isPrivate) {
      bigintBalance = await this.ethersService.decryptPrivateBalance(
        fromAccount.privateKey,
        fromAccount.networkAesKey,
        bigintBalance,
      );
    }

    const balanceToSend = this.replaceLessSignificantDigits(
      bigintBalance / 10n,
      3,
    );
    if (balanceToSend === 0n) return;

    return this.appService.transferToken({
      tokenId: token.id,
      fromIndex: fromAccount.index,
      toIndex: toAccount.index,
      tokenAmountInWei: balanceToSend.toString(),
    });
  }

  replaceLessSignificantDigits(value: bigint, x: number): bigint {
    if (x < 0) {
      throw new Error('The number of digits to replace must be non-negative.');
    }

    const factor = BigInt(10) ** BigInt(x); // Compute 10^x as a bigint
    return (value / factor) * factor; // Remove and replace the less significant digits with 0
  }
}
