import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { HDNodeWallet, TransactionResponse, Wallet } from 'ethers';
import { ConfigService } from '@nestjs/config';
import { CotiTransactionsEnvVariableNames } from './types/env-validation.type';
import {
  createAccountEntity,
  createActivityEntity,
  createTransactionEntity,
  getAccountByIndex,
  getAccountCount,
  getAccountsByIndexes,
  getActionByType,
  getAppStateByName,
} from './entities';
import { DataSource, EntityManager } from 'typeorm';
import { exec } from './utils/helpers';
import { AppStateNames } from './types/app-state-names';
import {
  AccountResponse,
  OnboardAccountRequest,
  PickRandomAccountsToSendCotiRequest,
  PickRandomAccountsToSendCotiResponse,
  SendCotiFromAccountToAccountRequest,
  SendCotiFromFaucetRequest,
} from './dtos/account.dto';
import { EthersService } from './services/ethers.service';
import { ActionEnum } from './enums/action.enum';

@Injectable()
export class AppService {
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly ethersService: EthersService,
  ) {}
  getHello(): string {
    return 'Hello World!';
  }

  async createAccount(): Promise<AccountResponse> {
    const seedPhrase = this.configService.get<string>(
      CotiTransactionsEnvVariableNames.SEED_PHRASE,
    );
    const manager = this.dataSource.manager;
    const newAccount = await manager.transaction(
      async (transactionManager: EntityManager) => {
        const [appStateError, appState] = await exec(
          getAppStateByName(
            transactionManager,
            AppStateNames.ACCOUNT_INDEX,
            true,
          ),
        );
        if (appStateError) {
          throw new InternalServerErrorException('Could not get wallet index');
        }
        const [actionError, action] = await exec(
          getActionByType(transactionManager, ActionEnum.CreateAccount),
        );
        if (actionError) {
          throw new InternalServerErrorException('Could not get action');
        }
        const wallet = HDNodeWallet.fromPhrase(
          seedPhrase,
          null,
          `m/44'/60'/0'/0`,
        );
        const newWallet = wallet.derivePath(appState.value);
        const [newWalletEntityError, newWalletEntity] = await exec(
          createAccountEntity(transactionManager, {
            index: Number(appState.value),
            privateKey: newWallet.privateKey,
            address: newWallet.address,
          }),
        );
        if (newWalletEntityError) {
          throw new InternalServerErrorException(
            'Failed to create new account in db',
          );
        }
        appState.value = (Number(appState.value) + 1).toString();
        const [appStateSaveError] = await exec(
          transactionManager.save(appState),
        );
        if (appStateSaveError) {
          throw new InternalServerErrorException(
            'Failed to save account index',
          );
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
      },
    );
    await this.sendCotiFromFaucet({
      toIndex: newAccount.index,
      // TODO: make it dynamic
      amountInCoti: '1',
    });
    return new AccountResponse(newAccount);
  }

  async sendCotiFromFaucet(
    params: SendCotiFromFaucetRequest,
  ): Promise<TransactionResponse> {
    const manager = this.dataSource.manager;
    return manager.transaction(async (transactionManager: EntityManager) => {
      const [actionError, action] = await exec(
        getActionByType(transactionManager, ActionEnum.SendCotiFromFaucet),
      );
      if (actionError) {
        throw new InternalServerErrorException('Could not get action');
      }
      const seedPhrase = this.configService.get<string>(
        CotiTransactionsEnvVariableNames.SEED_PHRASE,
      );
      const faucetWallet = Wallet.fromPhrase(seedPhrase);

      const [accountError, account] = await exec(
        getAccountByIndex(transactionManager, params.toIndex),
      );
      if (accountError) {
        throw new InternalServerErrorException('Failed to get account');
      }
      if (!account) {
        throw new BadRequestException('Account index does not exists');
      }
      const tx = await this.ethersService.sendEthereum(
        faucetWallet.privateKey,
        account.address,
        params.amountInCoti,
      );
      const [transactionEntityError, transactionEntity] = await exec(
        createTransactionEntity(transactionManager, tx),
      );
      // fill the activity in the db
      if (transactionEntityError) {
        throw new BadRequestException(
          `Send transaction without saving it or the activity txHash: ${tx.hash}`,
        );
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

  async pickRandomAccountsToSendCoti(
    params: PickRandomAccountsToSendCotiRequest,
  ): Promise<PickRandomAccountsToSendCotiResponse> {
    const manager = this.dataSource.manager;
    const [accountsCountError, accountsCount] = await exec(
      getAccountCount(manager),
    );
    if (accountsCountError) {
      throw new InternalServerErrorException('Failed to to get account count');
    }

    const doubleCount = params.count * 2;
    // we need it to be double so we can send and receive to unique indexes
    if (accountsCount < doubleCount) {
      throw new BadRequestException(
        `The requested ids count times 2 for send and receive ${doubleCount} is greater than the existing accounts count ${accountsCount}`,
      );
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

  async sendCotiFromAccountToAccount(
    params: SendCotiFromAccountToAccountRequest,
  ): Promise<TransactionResponse> {
    const manager = this.dataSource.manager;
    return await manager.transaction(
      async (transactionManager: EntityManager) => {
        const [actionError, action] = await exec(
          getActionByType(transactionManager, ActionEnum.SendCoti),
        );
        if (actionError) {
          throw new InternalServerErrorException('Could not get action');
        }
        const [accountsError, accounts] = await exec(
          getAccountsByIndexes(transactionManager, [
            params.fromIndex,
            params.toIndex,
          ]),
        );
        if (accountsError) {
          throw new InternalServerErrorException('Failed to get accounts');
        }
        if (accounts.length < 2) {
          throw new BadRequestException(
            'From index and/or to index does not exists',
          );
        }
        const accountFrom = accounts.find((x) => x.index === params.fromIndex);
        const accountTo = accounts.find((x) => x.index === params.toIndex);

        const tx = await this.ethersService.sendEthereum(
          accountFrom.privateKey,
          accountTo.address,
          params.amountInCoti,
        );
        const [transactionEntityError, transactionEntity] = await exec(
          createTransactionEntity(transactionManager, tx),
        );
        // fill the activity in the db
        if (transactionEntityError) {
          throw new BadRequestException(
            `Send transaction without saving it or the activity txHash: ${tx.hash}`,
          );
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
      },
    );
  }

  async onboardAccount(
    params: OnboardAccountRequest,
  ): Promise<TransactionResponse> {
    const manager = this.dataSource.manager;
    return await manager.transaction(
      async (transactionManager: EntityManager) => {
        const [actionError, action] = await exec(
          getActionByType(transactionManager, ActionEnum.OnboardAccount),
        );
        if (actionError) {
          throw new InternalServerErrorException('Could not get action');
        }
        const [accountError, account] = await exec(
          getAccountByIndex(transactionManager, params.index),
        );
        if (accountError) {
          throw new InternalServerErrorException('Failed to get account');
        }
        if (!account) {
          throw new BadRequestException('Account index does not exists');
        }

        if (account.networkAesKey) {
          throw new BadRequestException(
            `Account with index: ${account.index} already onboarded`,
          );
        }

        const onboardInfo = await this.ethersService.onboard(
          account.privateKey,
        );
        if (!onboardInfo) {
          throw new BadRequestException('Failed to onboard');
        }
        const tx = await this.ethersService.getTransactionResponse(
          onboardInfo.txHash,
        );
        account.networkAesKey = onboardInfo.aesKey;
        await manager.save(account);

        const [transactionEntityError, transactionEntity] = await exec(
          createTransactionEntity(transactionManager, tx),
        );
        // fill the activity in the db
        if (transactionEntityError) {
          throw new BadRequestException(
            `Send transaction without saving it or the activity txHash: ${tx.hash}`,
          );
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
      },
    );
  }
}
