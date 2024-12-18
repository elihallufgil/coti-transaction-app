import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, FindManyOptions, FindOptionsWhere } from 'typeorm';
import { EthersService } from './ethers.service';
import {
  AccountsEntity,
  ActionsEntity,
  createTransactionEntity,
  findTokens,
  getAccountByAddress,
  getAccountIndexesThatReceiveToken,
  getAccountsByIds,
  getAccountsByIndexes,
  getAccountsNonce,
  getAccountsToOnboard,
  getActivityByTxId,
  getAllActions,
  getLastHourActivityPerAction,
  getTokensCount,
  getTransactionWithStatusHandle,
  getTransactionWithStatusNull,
  isFaucetPendingTransactionToBig,
  isThereVerifiedTransactionInTheLast5Min,
  TokensEntity,
  TransactionsEntity,
} from '../entities';
import { FeeData, formatEther, TransactionReceipt, TransactionResponse, Wallet } from 'ethers';
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

  async cleanStuckAccounts() {
    const manager = this.datasource.manager;
    const random = Math.random();
    const transactionNumber = Math.ceil(random * 20);
    this.logger.log(`[cleanStuckAccounts][Getting ${transactionNumber} transaction(s) with status 2 and not cancelled]`);
    const transactions = await getTransactionWithStatusHandle(manager, transactionNumber);
    if (transactions.length == 0) {
      this.logger.log(`[cleanStuckAccounts][Nothing to clean]`);
      return;
    }
    this.logger.warn(`[cleanStuckAccounts][Found ${transactions.length} transaction(s) with status 2 and not cancelled]`);
    const txHashToReceiptMap: Map<string, TransactionReceipt | null> = new Map<string, TransactionReceipt | null>();
    // try to find in the node, if exist save it with the right params
    const receiptPromises = [];
    for (const tx of transactions) {
      receiptPromises.push(this.ethersService.getTransactionReceipt(tx.hash).then(r => txHashToReceiptMap.set(tx.hash, r)));
    }
    await Promise.allSettled(receiptPromises);

    const transactionsWithReceipt = [];
    for (const tx of transactions) {
      const receipt = txHashToReceiptMap.get(tx.hash);
      if (receipt) {
        transactionsWithReceipt.push(tx.id);
        tx.status = receipt.status;
        tx.blockNumber = receipt.blockNumber;
        tx.gasUsed = receipt.gasUsed.toString();
        tx.index = receipt.index;
        if (receipt.gasPrice) tx.gasPrice = receipt.gasPrice.toString();
      }
    }
    if (transactionsWithReceipt.length > 0) {
      this.logger.warn(`[cleanStuckAccounts][Updating ${transactionsWithReceipt.length} transaction(s) with receipt]`);
      await manager.save(transactions.filter(t => transactionsWithReceipt.includes(t.id)));
    }

    const transactionsWithoutReceipt = transactions.filter(t => !transactionsWithReceipt.includes(t.id));
    if (transactionsWithoutReceipt.length > 0) {
      const transactionCancelPromises = [];
      this.logger.warn(`[cleanStuckAccounts][Cleaning ${transactionsWithoutReceipt.length} transaction(s) without receipt]`);
      const feeData = await this.ethersService.provider.getFeeData();
      for (const transactionWithoutReceipt of transactionsWithoutReceipt) {
        transactionCancelPromises.push(this.handleTransactionCancel(transactionWithoutReceipt, feeData));
      }
      const transactionCancelResults = await Promise.allSettled(transactionCancelPromises);
      const successfulCancellationResults = transactionCancelResults.filter(result => result.status === 'fulfilled');
      const rejectedCancellationResults = transactionCancelResults.filter(result => result.status === 'rejected');
      this.logger.warn(`[cleanStuckAccounts][Successfully cleaned ${successfulCancellationResults.length} transaction(s)]`);
      if (rejectedCancellationResults.length > 0) {
        this.logger.error(`[cleanStuckAccounts][Error at cleaning ${rejectedCancellationResults.length} transaction(s)]`);
      }
    }
  }

  async handleTransactionCancel(transaction: TransactionsEntity, feeData: FeeData): Promise<void> {
    const manager = this.datasource.manager;
    // check if actual nonce is greater if yes mark it canceled and the activity canceled
    const actualNonce = await this.ethersService.getNextNonce(transaction.from);
    const activity = await getActivityByTxId(manager, transaction.id);
    if (actualNonce > transaction.nonce) {
      transaction.isCanceled = true;
      activity.isCanceled = true;
      await manager.save([transaction, activity]);
      return;
    }
    // if there isn't send a cancel transaction
    const account = await getAccountByAddress(manager, transaction.from);
    const tx = await this.sendCancellationTransaction(account, transaction, feeData);
    // .wait the cancel transaction
    const txSendResult = await this.awaitWithTimeout(tx.wait(), 25000);
    if (!txSendResult) {
      throw new Error(`In Block timeout for transaction ${transaction.id}`);
    }
    await createTransactionEntity(manager, tx);

    // if succeed save the cancel transaction and mark the old transaction and the activity as canceled
    transaction.isCanceled = true;
    activity.isCanceled = true;
    await manager.save([transaction, activity]);
  }

  async sendCancellationTransaction(account: AccountsEntity, transaction: TransactionsEntity, feeData: FeeData): Promise<TransactionResponse> {
    let maxFeePerGas = feeData.maxFeePerGas > (BigInt(transaction.maxFeePerGas) * 110n) / 100n ? feeData.maxFeePerGas : (BigInt(transaction.maxFeePerGas) * 110n) / 100n;
    let maxPriorityFeePerGas =
      feeData.maxPriorityFeePerGas > (BigInt(transaction.maxPriorityFeePerGas) * 110n) / 100n
        ? feeData.maxPriorityFeePerGas
        : (BigInt(transaction.maxPriorityFeePerGas) * 110n) / 100n;
    let error;
    for (let i = 0; i < 5; i++) {
      try {
        maxFeePerGas = (maxFeePerGas * BigInt(100 + i * 10)) / 100n;
        maxPriorityFeePerGas = (maxPriorityFeePerGas * BigInt(100 + i * 10)) / 100n;
        const wallet = new Wallet(account.privateKey, this.ethersService.provider);
        return await wallet.sendTransaction({
          from: account.address,
          to: account.address,
          value: 0n,
          nonce: transaction.nonce,
          type: 2,
          maxFeePerGas,
          maxPriorityFeePerGas,
        });
      } catch (e) {
        if (e.code !== 'REPLACEMENT_UNDERPRICED') {
          throw e;
        }
        error = e;
      }
    }
    throw error;
  }

  async checkTransactionsComplete() {
    const manager = this.datasource.manager;
    await manager.transaction(async (transactionManager: EntityManager) => {
      const take = 20;
      // find up to 10 transaction from db with no status
      const transactionsEntities = await getTransactionWithStatusNull(transactionManager, take);
      this.logger.log(`[checkTransactionsComplete][Found ${transactionsEntities.length}/${take} to handle]`);
      if (!transactionsEntities?.length) return;
      // request receipts
      const txHashToReceiptMap: Map<string, TransactionReceipt | null> = new Map<string, TransactionReceipt | null>();
      const receiptPromises = [];
      for (const tx of transactionsEntities) {
        receiptPromises.push(this.ethersService.getTransactionReceipt(tx.hash).then(r => txHashToReceiptMap.set(tx.hash, r)));
      }
      await Promise.allSettled(receiptPromises);
      // fill fields
      // if transaction is 10 minutes old and doesn't get any answer mark it with status 2
      for (const tx of transactionsEntities) {
        const receipt = txHashToReceiptMap.get(tx.hash);
        if (!receipt) {
          this.logger.warn(`[checkTransactionsComplete][Didnt find receipt for txHash ${tx.hash}]`);
          const nowMinus10Minutes = new Date();
          nowMinus10Minutes.setMinutes(nowMinus10Minutes.getMinutes() - 10);
          const transactionCreateTime = tx.createTime;
          if (transactionCreateTime < nowMinus10Minutes) {
            this.logger.warn(`[checkTransactionsComplete][Timeout to handle receipt for txHash ${tx.hash}]`);
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
    const lastHourActivityPerActionMap = await getLastHourActivityPerAction(manager);
    const extendedActions: (ActionsEntity & {
      lastHourActivityCount: number;
    })[] = actions.map(x => ({
      ...x,
      lastHourActivityCount: lastHourActivityPerActionMap.get(x.type) || 0,
    }));

    console.table(extendedActions, ['type', 'randomRange', 'maxPerHour', 'lastHourActivityCount']);
    const filteredActions = extendedActions.filter(x => x.randomRange > 0 && x.lastHourActivityCount < x.maxPerHour);
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
    const lastHourActivityPerActionMap = await getLastHourActivityPerAction(manager);
    const extendedActions: (ActionsEntity & {
      lastHourActivityCount: number;
    })[] = actions.map(x => ({
      ...x,
      lastHourActivityCount: lastHourActivityPerActionMap.get(x.type) || 0,
    }));

    console.table(extendedActions, ['type', 'randomRange', 'maxPerHour', 'lastHourActivityCount']);
    const filteredActions = extendedActions.filter(x => x.randomRange > 0 && x.lastHourActivityCount < x.maxPerHour);
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
    const manager = this.datasource.manager;
    // faucet protection
    const isFaucetSendToMuch = await isFaucetPendingTransactionToBig(manager, this.configService);
    if (isFaucetSendToMuch) {
      this.logger.warn(`[runSlowActivities][handleCreateAccount] Faucet pending transactions count is too big`);
      return;
    }
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(`[runActivities][handleCreateAccount][activityCount/randomRange ${activityCount}/${randomRange}]`);
    if (activityCount === 0) return;
    for (let i = 0; i < activityCount; i++) {
      await this.appService.createAccount();
    }
    this.logger.log(`[runActivities][handleCreateAccount][${activityCount} created account]`);
  }

  async isStuckAccounts(manager: EntityManager, indexes: number[]): Promise<Map<number, boolean>> {
    const isStuckMap = new Map<number, boolean>();
    // get latest nonce in the transaction and latest confirmed nonce
    const nonceMap = await getAccountsNonce(manager, indexes);
    for (const [key, value] of nonceMap) {
      isStuckMap.set(key, (Number(value.maxCompletedNonce) || 0) + 1 < Math.max(Number(value.maxStuckNonce) || 0, Number(value.maxPendingNonce) || 0));
    }
    return isStuckMap;
  }

  async handleSendCoti(action: ActionsEntity) {
    const manager = this.datasource.manager;
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(`[runActivities][handleSendCoti][activityCount/randomRange ${activityCount}/${randomRange}]`);
    if (activityCount === 0) return;
    const accountIndexesRes = await this.appService.pickRandomAccountsToSendCoti({
      count: activityCount,
    });

    let accounts = await getAccountsByIndexes(manager, accountIndexesRes.accountsIndexes);

    const stuckMap = await this.isStuckAccounts(
      manager,
      accounts.map(x => x.index),
    );
    for (const account of accounts) {
      const isStuck = stuckMap.get(account.index);
      account.isStuck = !!isStuck;
    }
    await manager.save(accounts);
    accounts = accounts.filter(x => !x.isStuck);
    if (accounts.length % 2 !== 0) accounts.pop();

    const balanceMap = await this.ethersService.getBalances(accounts.map(a => a.address));
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
      const balanceToSend = this.replaceLessSignificantDigits(sendingAccountBalance / 10n, 9);
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
    this.logger.log(`[runActivities][handleSendCoti][${activityCount} tx(s) sent coti]`);
  }

  async handleOnboardAccount(action: ActionsEntity) {
    const manager = this.datasource.manager;
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(`[runActivities][handleOnboardAccount][activityCount/randomRange ${activityCount}/${randomRange}]`);
    if (activityCount === 0) return;
    const onboardPromises = [];
    let accountsToOnboard = await getAccountsToOnboard(manager, activityCount);
    const stuckMap = await this.isStuckAccounts(
      manager,
      accountsToOnboard.map(x => x.index),
    );

    for (const account of accountsToOnboard) {
      const isStuck = stuckMap.get(account.index);

      account.isStuck = !!isStuck;
    }
    await manager.save(accountsToOnboard);
    accountsToOnboard = accountsToOnboard.filter(x => !x.isStuck);

    for (const account of accountsToOnboard) {
      onboardPromises.push(this.appService.onboardAccount({ index: account.index }));
    }
    await Promise.allSettled(onboardPromises);
    this.logger.log(`[runActivities][handleOnboardAccount][${activityCount} tx(s) onboarded account]`);
  }

  async handleSendCotiFromFaucet(action: ActionsEntity) {
    // faucet protection
    const manager = this.datasource.manager;
    const isFaucetSendToMuch = await isFaucetPendingTransactionToBig(manager, this.configService);
    if (isFaucetSendToMuch) {
      this.logger.warn(`[runSlowActivities][handleSendCotiFromFaucet] Faucet pending transactions count is too big`);
      return;
    }
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    this.logger.log(`[runActivities][handleSendCotiFromFaucet][activityCount/randomRange ${activityCount}/${randomRange}]`);
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
    this.logger.log(`[runActivities][handleSendCotiFromFaucet][${activityCount} tx(s) sent coti from faucet]`);
  }

  async awaitWithTimeout<T>(promise: Promise<T>, timeoutMs) {
    // Create a promise that rejects after the timeout
    const timeoutPromise: Promise<void> = new Promise((_, reject) => setTimeout(() => reject(new Error('Operation timed out')), timeoutMs));

    // Race the provided promise and the timeout promise
    return Promise.race([promise, timeoutPromise]);
  }

  async handleCreateToken(action: ActionsEntity) {
    const manager = this.datasource.manager;
    // faucet protection
    const isFaucetSendToMuch = await isFaucetPendingTransactionToBig(manager, this.configService);
    if (isFaucetSendToMuch) {
      this.logger.warn(`[runSlowActivities][handleCreateToken] Faucet pending transactions count is too big`);
      return;
    }
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    const isPrivate = action.type === ActionEnum.CreatePrivateToken;
    this.logger.log(`[runSlowActivities][handleCreateToken][${isPrivate ? 'private' : 'not private'}][activityCount/randomRange ${activityCount}/${randomRange}]`);
    if (activityCount === 0) return;
    const accountIndexesRes = await this.appService.pickRandomAccountsToRefill({
      count: activityCount,
    });
    let accounts = await getAccountsByIndexes(manager, accountIndexesRes.accountsIndexes);
    const stuckMap = await this.isStuckAccounts(
      manager,
      accounts.map(x => x.index),
    );
    for (const account of accounts) {
      const isStuck = stuckMap.get(account.index);

      account.isStuck = !!isStuck;
    }

    await manager.save(accounts);
    accounts = accounts.filter(x => !x.isStuck);
    const accountIndexes = accounts.map(x => x.index);
    const createTokenPromises = [];
    for (const accountIndex of accountIndexes) {
      createTokenPromises.push(this.createTokenWrapper(accountIndex, isPrivate));
    }
    await Promise.allSettled(createTokenPromises);
    this.logger.log(`[runSlowActivities][handleCreateToken][${isPrivate ? 'private' : 'not private'}][${activityCount} tx(s) created token]`);
  }

  async createTokenWrapper(accountIndex: number, isPrivate: boolean) {
    const refillTx = await this.appService.sendCotiFromFaucet({
      toIndex: accountIndex,
      amountInCoti: '5',
    });

    await this.awaitWithTimeout(refillTx.wait(), 25000);

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
    this.logger.log(`[runSlowActivities][handleMintToken][${isPrivate ? 'private' : 'not private'}][activityCount/randomRange ${activityCount}/${randomRange}]`);
    if (activityCount === 0) return;
    const accountIndexesRes = await this.appService.pickRandomAccountsToRefill({
      count: activityCount,
    });
    const findOptions: FindOptionsWhere<TokensEntity> = { isPrivate };
    // get activity count tokens
    const tokensCount = await getTokensCount(manager, findOptions);
    if (tokensCount === 0) return;
    const randomSkip = activityCount >= tokensCount ? 0 : Math.round(Math.random() * (tokensCount - activityCount));
    const findManyOptions: FindManyOptions<TokensEntity> = {
      where: findOptions,
      skip: randomSkip,
      take: activityCount,
    };
    let tokens = await findTokens(manager, findManyOptions);
    const tokensOwnerIds = tokens.map(t => t.ownerAccountId);
    let accounts = await getAccountsByIds(manager, tokensOwnerIds);
    const stuckMap = await this.isStuckAccounts(
      manager,
      accounts.map(x => x.index),
    );
    for (const account of accounts) {
      const isStuck = stuckMap.get(account.index);
      account.isStuck = !!isStuck;
    }
    await manager.save(accounts);
    accounts = accounts.filter(x => !x.isStuck);
    tokens = tokens.filter(t => accounts.find(a => a.id === t.ownerAccountId));
    // send for each token
    const mintTokenPromises = [];
    for (const token of tokens) {
      const toIndex = accountIndexesRes.accountsIndexes.pop();
      const mintAmount = BigInt(Math.round(Math.random() * 1000)) * 10n ** BigInt(token.decimals);
      mintTokenPromises.push(
        this.appService.mintToken({
          tokenId: token.id,
          toIndex,
          tokenAmountInWei: mintAmount.toString(),
        }),
      );
    }
    await Promise.allSettled(mintTokenPromises);
    this.logger.log(`[runSlowActivities][handleMintToken][${isPrivate ? 'private' : 'not private'}][${activityCount} tx(s) minted token]`);
  }

  async handleTransferToken(action: ActionsEntity) {
    const manager = this.datasource.manager;
    const randomRange = action.randomRange;
    const activityCount = Math.round(Math.random() * randomRange);
    const isPrivate = action.type === ActionEnum.TransferPrivateToken;
    this.logger.log(`[runSlowActivities][handleTransferToken][${isPrivate ? 'private' : 'not private'}][activityCount/randomRange ${activityCount}/${randomRange}]`);
    if (activityCount === 0) return;
    const findOptions: FindOptionsWhere<TokensEntity> = { isPrivate };
    // get activity count tokens
    const tokensCount = await getTokensCount(manager, findOptions);
    if (tokensCount === 0) return;
    const randomSkip = activityCount >= tokensCount ? 0 : Math.round(Math.random() * (tokensCount - activityCount));
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
    this.logger.log(`[runSlowActivities][handleTransferToken][${isPrivate ? 'private' : 'not private'}][${activityCount} tx(s) transferred token]`);
  }

  async sendTokenWrapper(token: TokensEntity): Promise<TransactionResponse> {
    const manager = this.datasource.manager;
    // pick 1 account with affiliation to the token
    const accountsIndexThatReceivedToken = await getAccountIndexesThatReceiveToken(manager, token.id);
    const randomIndex = accountsIndexThatReceivedToken[Math.round(Math.random() * (accountsIndexThatReceivedToken.length - 1))];
    if (randomIndex === null) return;
    // pick 1 random account
    const accountToIndexRes = await this.appService.pickRandomAccountsToRefill({
      count: 1,
      banIndexList: [randomIndex],
    });
    const accounts = await getAccountsByIndexes(manager, [randomIndex, accountToIndexRes.accountsIndexes[0]]);
    const stuckMap = await this.isStuckAccounts(
      manager,
      accounts.map(x => x.index),
    );
    for (const account of accounts) {
      const isStuck = stuckMap.get(account.index);
      account.isStuck = !!isStuck;
    }

    await manager.save(accounts);

    const fromAccount = accounts.find(x => x.index === randomIndex);
    if (fromAccount.isStuck) return;
    const toAccount = accounts.find(x => x.index !== randomIndex);
    // get balances
    let bigintBalance = await this.ethersService.getErc20Balance(token.address, fromAccount.address, token.isPrivate);
    if (token.isPrivate) {
      bigintBalance = await this.ethersService.decryptPrivateBalance(fromAccount.privateKey, fromAccount.networkAesKey, bigintBalance);
    }

    const balanceToSend = this.replaceLessSignificantDigits(bigintBalance / 10n, 3);
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
