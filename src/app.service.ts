import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ContractTransactionResponse, formatEther, HDNodeWallet, TransactionResponse } from 'ethers';
import { ConfigService } from '@nestjs/config';
import { CotiTransactionsEnvVariableNames } from './types/env-validation.type';
import {
  createAccountEntity,
  createActivityEntity,
  createTokenEntity,
  createTransactionEntity,
  getAccountByIndex,
  getAccountCount,
  getAccountsByIndexes,
  getActionByType,
  getAppStateByName,
  getToken,
  getTokenToGenerate,
  getTokenWithOwnerAccount,
} from './entities';
import { DataSource, EntityManager, InsertResult } from 'typeorm';
import { exec } from './utils/helpers';
import { AppStateNames } from './types/app-state-names';
import {
  AccountResponse,
  CreateTokenRequest,
  GetFaucetWalletAddressResponse,
  GetTokenBalanceRequest,
  MintTokenToAccountRequest,
  OnboardAccountRequest,
  PickRandomAccountsToSendCotiRequest,
  PickRandomAccountsToSendCotiResponse,
  SendCotiFromAccountToAccountRequest,
  SendCotiFromFaucetRequest,
  TokenBalanceResponse,
  TokenResponse,
  TransferTokenToAccountRequest,
} from './dtos/account.dto';
import { EthersService } from './services/ethers.service';
import { ActionEnum } from './enums/action.enum';
import { TokensToGenerate } from './configs/tokens-to-generate';
import { insertManyTokensToGenerate } from './entities/tokens-to-generate.entity';

@Injectable()
export class AppService {
  logger = new Logger(AppService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly ethersService: EthersService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async insertTokensToGenerate(): Promise<InsertResult> {
    const manager = this.dataSource.manager;
    const tokensToGenerate = TokensToGenerate;
    return insertManyTokensToGenerate(manager, tokensToGenerate);
  }

  async createAccount(): Promise<AccountResponse> {
    const seedPhrase = this.configService.get<string>(CotiTransactionsEnvVariableNames.SEED_PHRASE);
    const manager = this.dataSource.manager;
    const newAccount = await manager.transaction(async (transactionManager: EntityManager) => {
      const [appStateError, appState] = await exec(getAppStateByName(transactionManager, AppStateNames.ACCOUNT_INDEX, true));
      if (appStateError) {
        throw new InternalServerErrorException('Could not get wallet index');
      }
      const [actionError, action] = await exec(getActionByType(transactionManager, ActionEnum.CreateAccount));
      if (actionError) {
        throw new InternalServerErrorException('Could not get action');
      }
      const wallet = HDNodeWallet.fromPhrase(seedPhrase, null, `m/44'/60'/0'/0`);
      const newWallet = wallet.derivePath(appState.value);
      const [newWalletEntityError, newWalletEntity] = await exec(
        createAccountEntity(transactionManager, {
          index: Number(appState.value),
          privateKey: newWallet.privateKey,
          address: newWallet.address,
        }),
      );
      if (newWalletEntityError) {
        throw new InternalServerErrorException('Failed to create new account in db');
      }
      appState.value = (Number(appState.value) + 1).toString();
      const [appStateSaveError] = await exec(transactionManager.save(appState));
      if (appStateSaveError) {
        throw new InternalServerErrorException('Failed to save account index');
      }
      const [newActivityError] = await exec(
        createActivityEntity(transactionManager, {
          actionId: action.id,
          data: `account address: ${newWallet.address}`,
        }),
      );
      if (newActivityError) {
        throw new InternalServerErrorException('Failed to create activity');
      }
      return newWalletEntity;
    });
    await this.sendCotiFromFaucet({
      toIndex: newAccount.index,
      // TODO: make it dynamic
      amountInCoti: '1',
    });
    return new AccountResponse(newAccount);
  }

  async createNewToken(params: CreateTokenRequest): Promise<TokenResponse> {
    const manager = this.dataSource.manager;
    const { isPrivate, isBusiness, name, symbol, decimals, accountIndex } = params;
    let nameToUse = name;
    let symbolToUse = symbol;
    const newTokenEntity = await manager.transaction(async (transactionManager: EntityManager) => {
      const [appStateError] = await exec(getAppStateByName(transactionManager, AppStateNames.CREATE_TOKEN_LOCK, true));
      if (appStateError) {
        throw new InternalServerErrorException('Could not get wallet index');
      }
      if (!nameToUse || !symbolToUse) {
        const tokenToGenerate = await getTokenToGenerate(transactionManager);
        if (!tokenToGenerate) throw new BadRequestException(`No more name or symbol suggestions, please provide name and symbol`);
        if (isPrivate) {
          nameToUse = `Private ${tokenToGenerate.name}`;
          symbolToUse = `P${tokenToGenerate.symbol}`;
        } else {
          nameToUse = tokenToGenerate.name;
          symbolToUse = tokenToGenerate.symbol;
        }
        tokenToGenerate.isGenerated = true;
        await transactionManager.save(tokenToGenerate);
      }
      const [actionError, action] = await exec(getActionByType(transactionManager, isPrivate ? ActionEnum.CreatePrivateToken : ActionEnum.CreateToken));
      if (actionError) {
        throw new InternalServerErrorException('Could not get action');
      }
      const account = await getAccountByIndex(transactionManager, accountIndex);
      // create new token transaction
      const token = await this.ethersService.deployToken({
        tokenName: nameToUse,
        tokenSymbol: symbolToUse,
        decimals,
        isPrivate,
        privateKey: account.privateKey,
        owner: account.address,
      });

      const deploymentTransaction = token.deploymentTransaction();
      const tokenAddress = await token.getAddress();
      const [tokenEntityError, tokenEntity] = await exec(
        createTokenEntity(transactionManager, {
          address: tokenAddress,
          decimals,
          symbol: symbolToUse,
          name: nameToUse,
          isPrivate,
          isBusiness,
          ownerAccountId: account.id,
        }),
      );
      if (tokenEntityError) {
        throw new BadRequestException(`Could not create db token address ${tokenAddress} `);
      }
      const deploymentTransactionWithTo: Partial<ContractTransactionResponse> = {
        ...deploymentTransaction,
        to: tokenAddress,
      };
      const [transactionEntityError, transactionEntity] = await exec(createTransactionEntity(transactionManager, deploymentTransactionWithTo));
      // fill the activity in the db
      if (transactionEntityError) {
        throw new BadRequestException(`Send transaction without saving it or the activity txHash: ${deploymentTransaction.hash}`);
      }
      const [newActivityError] = await exec(
        createActivityEntity(transactionManager, {
          actionId: action.id,
          transactionId: transactionEntity.id,
          from: account.address,
          to: tokenAddress,
          tokenId: tokenEntity.id,
          data: `create new ${isPrivate ? 'private token' : 'token'} ${tokenAddress} owned by account address: ${account.address}`,
        }),
      );
      if (newActivityError) {
        throw new InternalServerErrorException('Failed to send deploy token transaction');
      }

      return tokenEntity;
    });
    return new TokenResponse(newTokenEntity);
  }

  async getFaucetWallet(manager: EntityManager, lock = false) {
    const [appStateError, appState] = await exec(getAppStateByName(manager, AppStateNames.FAUCET_ACCOUNT_INDEX, lock));
    if (appStateError) {
      throw new InternalServerErrorException('Could not get FAUCET_ACCOUNT_INDEX app state');
    }

    const seedPhrase = this.configService.get<string>(CotiTransactionsEnvVariableNames.SEED_PHRASE);
    const wallet = HDNodeWallet.fromPhrase(seedPhrase, null, `m/44'/60'/0'/0`);
    return wallet.derivePath(appState.value);
  }

  async sendCotiFromFaucet(params: SendCotiFromFaucetRequest): Promise<TransactionResponse> {
    const manager = this.dataSource.manager;
    return manager.transaction(async (transactionManager: EntityManager) => {
      const [actionError, action] = await exec(getActionByType(transactionManager, ActionEnum.SendCotiFromFaucet, true));
      if (actionError) {
        throw new InternalServerErrorException('Could not get action');
      }
      const faucetWallet = await this.getFaucetWallet(transactionManager, true);

      const [accountError, account] = await exec(getAccountByIndex(transactionManager, params.toIndex));
      if (accountError) {
        throw new InternalServerErrorException('Failed to get account');
      }
      if (!account) {
        throw new BadRequestException('Account index does not exists');
      }
      const tx = await this.ethersService.sendEthereum(faucetWallet.privateKey, account.address, params.amountInCoti);
      const [transactionEntityError, transactionEntity] = await exec(createTransactionEntity(transactionManager, tx));
      // fill the activity in the db
      if (transactionEntityError) {
        throw new BadRequestException(`Send transaction without saving it or the activity txHash: ${tx.hash}`);
      }
      const [newActivityError] = await exec(
        createActivityEntity(transactionManager, {
          actionId: action.id,
          from: faucetWallet.address,
          to: tx.to,
          transactionId: transactionEntity.id,
          data: `Send ${params.amountInCoti} COTI from faucet to: ${account.address}`,
        }),
      );
      if (newActivityError) {
        throw new InternalServerErrorException('Failed to create activity');
      }
      return tx;
    });
  }

  async replaceFaucetAddress(): Promise<TransactionResponse> {
    const manager = this.dataSource.manager;
    return manager.transaction(async (transactionManager: EntityManager) => {
      const [appStateError, appState] = await exec(getAppStateByName(transactionManager, AppStateNames.FAUCET_ACCOUNT_INDEX, true));
      if (appStateError) {
        throw new InternalServerErrorException('Could not get FAUCET_ACCOUNT_INDEX app state');
      }
      const seedPhrase = this.configService.get<string>(CotiTransactionsEnvVariableNames.SEED_PHRASE);
      const wallet = HDNodeWallet.fromPhrase(seedPhrase, null, `m/44'/60'/0'/0`);
      const newFaucetIndex = Number(appState.value) + 1;
      if (isNaN(newFaucetIndex)) throw new InternalServerErrorException(`The new faucet index is not number: ${newFaucetIndex}`);
      const faucetWallet = wallet.derivePath(appState.value);
      const newFaucetWallet = wallet.derivePath(newFaucetIndex.toString());

      const balance = await this.ethersService.getBalance(newFaucetWallet.address);
      const nonce = await this.ethersService.getNextNonce(faucetWallet.address);
      const balanceInCoti = formatEther(balance);
      appState.value = newFaucetIndex.toString();
      await transactionManager.save(appState);
      return await this.ethersService.sendEthereum(faucetWallet.privateKey, newFaucetWallet.address, balanceInCoti, nonce);
    });
  }

  async getFaucetAddress(): Promise<GetFaucetWalletAddressResponse> {
    const manager = this.dataSource.manager;
    const faucetWallet = await this.getFaucetWallet(manager);
    const nonce = await this.ethersService.getNextNonce(faucetWallet.address);
    return { address: faucetWallet.address, nonce };
  }

  async pickRandomAccountsToSendCoti(params: PickRandomAccountsToSendCotiRequest): Promise<PickRandomAccountsToSendCotiResponse> {
    const manager = this.dataSource.manager;
    const [accountsCountError, accountsCount] = await exec(getAccountCount(manager));
    if (accountsCountError) {
      throw new InternalServerErrorException('Failed to to get account count');
    }

    const doubleCount = params.count * 2;
    // we need it to be double, so we can send and receive to unique indexes
    if (accountsCount < doubleCount) {
      throw new BadRequestException(`The requested ids count times 2 for send and receive ${doubleCount} is greater than the existing accounts count ${accountsCount}`);
    }
    const indexes: number[] = [];
    while (indexes.length < doubleCount) {
      const random = Math.random();
      const index = Math.round(random * accountsCount);
      if (indexes.includes(index)) continue;
      indexes.push(index);
    }
    return { accountsIndexes: indexes };
  }

  async pickRandomAccountsToRefill(params: PickRandomAccountsToSendCotiRequest): Promise<PickRandomAccountsToSendCotiResponse> {
    const manager = this.dataSource.manager;
    const [accountsCountError, accountsCount] = await exec(getAccountCount(manager));
    if (accountsCountError) {
      throw new InternalServerErrorException('Failed to to get account count');
    }

    if (accountsCount < params.count) {
      throw new BadRequestException(`The requested ids count refill ${params.count} is greater than the existing accounts count ${accountsCount}`);
    }
    const indexes: number[] = [];
    while (indexes.length < params.count) {
      const random = Math.random();
      const index = Math.round(random * accountsCount);
      if (indexes.includes(index) || params.banIndexList?.includes(index)) continue;
      indexes.push(index);
    }
    return { accountsIndexes: indexes };
  }

  async sendCotiFromAccountToAccount(params: SendCotiFromAccountToAccountRequest): Promise<TransactionResponse> {
    const manager = this.dataSource.manager;
    return await manager.transaction(async (transactionManager: EntityManager) => {
      const [actionError, action] = await exec(getActionByType(transactionManager, ActionEnum.SendCoti));
      if (actionError) {
        throw new InternalServerErrorException('Could not get action');
      }
      const [accountsError, accounts] = await exec(getAccountsByIndexes(transactionManager, [params.fromIndex, params.toIndex]));
      if (accountsError) {
        throw new InternalServerErrorException('Failed to get accounts');
      }
      if (accounts.length < 2) {
        throw new BadRequestException('From index and/or to index does not exists');
      }
      const accountFrom = accounts.find(x => x.index === params.fromIndex);
      const accountTo = accounts.find(x => x.index === params.toIndex);

      const tx = await this.ethersService.sendEthereum(accountFrom.privateKey, accountTo.address, params.amountInCoti);
      const [transactionEntityError, transactionEntity] = await exec(createTransactionEntity(transactionManager, tx));
      // fill the activity in the db
      if (transactionEntityError) {
        throw new BadRequestException(`Send transaction without saving it or the activity txHash: ${tx.hash}`);
      }
      const [newActivityError] = await exec(
        createActivityEntity(transactionManager, {
          actionId: action.id,
          from: accountFrom.address,
          to: tx.to,
          transactionId: transactionEntity.id,
          data: `Send ${params.amountInCoti} COTI from ${accountFrom.address} to: ${accountTo.address}`,
        }),
      );
      if (newActivityError) {
        throw new InternalServerErrorException('Failed to create activity');
      }
      return tx;
    });
  }

  async onboardAccount(params: OnboardAccountRequest): Promise<TransactionResponse> {
    const manager = this.dataSource.manager;
    return await manager.transaction(async (transactionManager: EntityManager) => {
      const [actionError, action] = await exec(getActionByType(transactionManager, ActionEnum.OnboardAccount));
      if (actionError) {
        throw new InternalServerErrorException('Could not get action');
      }
      const [accountError, account] = await exec(getAccountByIndex(transactionManager, params.index));
      if (accountError) {
        throw new InternalServerErrorException('Failed to get account');
      }
      if (!account) {
        throw new BadRequestException('Account index does not exists');
      }

      if (account.networkAesKey) {
        throw new BadRequestException(`Account with index: ${account.index} already onboarded`);
      }

      const [onboardInfoError, onboardInfo] = await exec(this.ethersService.onboard(account.privateKey));
      if (onboardInfoError || !onboardInfo) {
        throw new BadRequestException('Failed to onboard');
      }
      const tx = await this.ethersService.getTransactionResponse(onboardInfo.txHash);
      account.networkAesKey = onboardInfo.aesKey;
      await manager.save(account);

      const [transactionEntityError, transactionEntity] = await exec(createTransactionEntity(transactionManager, tx));
      // fill the activity in the db
      if (transactionEntityError) {
        throw new BadRequestException(`Send transaction without saving it or the activity txHash: ${tx.hash}`);
      }
      const [newActivityError] = await exec(
        createActivityEntity(transactionManager, {
          actionId: action.id,
          from: account.address,
          to: tx.to,
          transactionId: transactionEntity.id,
          data: `Onboard account with address: ${account.address}`,
        }),
      );
      if (newActivityError) {
        throw new InternalServerErrorException('Failed to create activity');
      }
      return tx;
    });
  }

  async mintToken(params: MintTokenToAccountRequest): Promise<TransactionResponse> {
    const manager = this.dataSource.manager;
    return await manager.transaction(async (transactionManager: EntityManager) => {
      const [tokenError, token] = await exec(getTokenWithOwnerAccount(transactionManager, params.tokenId));
      if (tokenError || !token || !token.ownerAccount) {
        throw new InternalServerErrorException('Failed to get token owner account');
      }
      const [actionError, action] = await exec(getActionByType(transactionManager, token.isPrivate ? ActionEnum.MintPrivateToken : ActionEnum.MintToken));
      if (actionError) {
        throw new InternalServerErrorException('Could not get action');
      }
      const [toAccountsError, toAccount] = await exec(getAccountByIndex(transactionManager, params.toIndex));
      if (toAccountsError || !toAccount) {
        throw new InternalServerErrorException('Failed to get to account');
      }

      const ownerAccount = token.ownerAccount;

      const tx = await this.ethersService.mintToken({
        tokenAddress: token.address,
        to: toAccount.address,
        weiAmount: params.tokenAmountInWei,
        networkAesKey: ownerAccount.networkAesKey,
        isPrivate: token.isPrivate,
        privateKey: ownerAccount.privateKey,
      });
      const [transactionEntityError, transactionEntity] = await exec(createTransactionEntity(transactionManager, tx));
      if (transactionEntityError) {
        throw new BadRequestException(`Send transaction without saving it or the activity txHash: ${tx.hash}`);
      }
      const [newActivityError] = await exec(
        createActivityEntity(transactionManager, {
          actionId: action.id,
          from: tx.from,
          to: toAccount.address,
          transactionId: transactionEntity.id,
          tokenId: token.id,
          data: `Mint ${params.tokenAmountInWei} ${token.name} to: ${toAccount.address}`,
        }),
      );
      if (newActivityError) {
        throw new InternalServerErrorException('Failed to create activity');
      }
      return tx;
    });
  }

  async transferToken(params: TransferTokenToAccountRequest): Promise<TransactionResponse> {
    const manager = this.dataSource.manager;
    return await manager.transaction(async (transactionManager: EntityManager) => {
      const [tokenError, token] = await exec(getToken(transactionManager, params.tokenId));
      if (tokenError) {
        throw new InternalServerErrorException('Failed to get token');
      }
      if (!token) {
        throw new BadRequestException(`Token with id: ${params.tokenId} does not exists`);
      }

      const [actionError, action] = await exec(getActionByType(transactionManager, token.isPrivate ? ActionEnum.TransferPrivateToken : ActionEnum.TransferToken));
      if (actionError) {
        throw new InternalServerErrorException('Could not get action');
      }

      const [fromAccountsError, fromAccount] = await exec(getAccountByIndex(transactionManager, params.fromIndex));
      if (fromAccountsError || !fromAccount) {
        throw new InternalServerErrorException('Failed to get from account');
      }

      const [toAccountsError, toAccount] = await exec(getAccountByIndex(transactionManager, params.toIndex));
      if (toAccountsError || !toAccount) {
        throw new InternalServerErrorException('Failed to get to account');
      }

      const tx = await this.ethersService.transferToken({
        tokenAddress: token.address,
        to: toAccount.address,
        weiAmount: params.tokenAmountInWei,
        networkAesKey: fromAccount.networkAesKey,
        isPrivate: token.isPrivate,
        privateKey: fromAccount.privateKey,
      });
      const [transactionEntityError, transactionEntity] = await exec(createTransactionEntity(transactionManager, tx));
      if (transactionEntityError) {
        throw new BadRequestException(`Send transaction without saving it or the activity txHash: ${tx.hash}`);
      }
      const [newActivityError] = await exec(
        createActivityEntity(transactionManager, {
          actionId: action.id,
          from: tx.from,
          to: toAccount.address,
          transactionId: transactionEntity.id,
          tokenId: token.id,
          data: `Transfer ${params.tokenAmountInWei} ${token.name} from: ${fromAccount.address} to: ${toAccount.address}`,
        }),
      );
      if (newActivityError) {
        throw new InternalServerErrorException('Failed to create activity');
      }
      return tx;
    });
  }

  async getTokenBalance(params: GetTokenBalanceRequest): Promise<TokenBalanceResponse> {
    const manager = this.dataSource.manager;

    const [tokenError, token] = await exec(getToken(manager, params.tokenId));
    if (tokenError) {
      throw new InternalServerErrorException('Failed to get token');
    }
    if (!token) {
      throw new BadRequestException(`Token with id: ${params.tokenId} does not exists`);
    }

    const [accountsError, account] = await exec(getAccountByIndex(manager, params.accountIndex));
    if (accountsError) {
      throw new InternalServerErrorException('Failed to get from account');
    }

    if (!account) {
      throw new InternalServerErrorException(`Account with index: ${params.accountIndex} does not exists`);
    }
    const bigintBalance = await this.ethersService.getErc20Balance(token.address, account.address, token.isPrivate);
    let balance = '';
    if (token.isPrivate) {
      try {
        const decryptedBalance = await this.ethersService.decryptPrivateBalance(account.privateKey, account.networkAesKey, bigintBalance);
        balance = decryptedBalance.toString();
      } catch (error) {
        balance = '*******';
      }
    } else {
      balance = bigintBalance.toString();
    }

    return new TokenBalanceResponse(account, token, balance.toString());
  }
}
