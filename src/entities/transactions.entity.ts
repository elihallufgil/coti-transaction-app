import { Column, Entity, EntityManager, In, IsNull } from 'typeorm';
import { TableNames } from './table-names';
import { BaseEntity } from './base.entity';
import { HDNodeWallet, TransactionResponse } from 'ethers';
import { getAppStateByName } from './app-states.entity';
import { AppStateNames } from '../types/app-state-names';
import { ConfigService } from '@nestjs/config';
import { CotiTransactionsEnvVariableNames } from '../types/env-validation.type';

@Entity(TableNames.TRANSACTIONS)
export class TransactionsEntity extends BaseEntity {
  @Column()
  blockNumber: number;

  @Column()
  index: number;

  @Column()
  type: number;

  @Column()
  nonce: number;

  @Column()
  gasLimit: string;

  @Column()
  gasPrice: string;

  @Column()
  maxPriorityFeePerGas: null | string;

  @Column()
  maxFeePerGas: null | string;

  @Column()
  from: string;

  @Column()
  to: null | string;

  @Column()
  gasUsed: string;

  @Column()
  status: number;

  @Column()
  data: string;

  @Column()
  value: string;

  @Column()
  hash: string;

  @Column()
  isCanceled: boolean;
}

export const createTransactionEntity = async (manager: EntityManager, transactionResponse: Partial<TransactionResponse>): Promise<TransactionsEntity> => {
  const partialTransactionEntity = transactionResponseToPartialTransactionEntity(transactionResponse);
  const transaction = manager.create(TransactionsEntity, partialTransactionEntity);
  return manager.save(transaction);
};

export const transactionResponseToPartialTransactionEntity = (tx: Partial<TransactionResponse>): Partial<TransactionsEntity> => {
  return {
    type: tx.type,
    nonce: tx.nonce,
    gasLimit: tx.gasLimit?.toString() || null,
    gasPrice: tx.gasPrice?.toString() || null,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString() || null,
    maxFeePerGas: tx.maxFeePerGas?.toString() || null,
    from: tx.from,
    to: tx.to,
    data: tx.data,
    value: tx.value.toString(),
    hash: tx.hash,
  };
};

export const getTransactionWithStatusNull = async (manager: EntityManager, take: number): Promise<TransactionsEntity[]> => {
  return manager.find(TransactionsEntity, {
    where: { status: IsNull() },
    take,
  });
};

export const getTransactionWithStatusHandle = async (manager: EntityManager, take: number): Promise<TransactionsEntity[]> => {
  return manager.find(TransactionsEntity, {
    where: { status: 2, isCanceled: false },
    take,
  });
};

export const isThereVerifiedTransactionInTheLast5Min = async (manager: EntityManager): Promise<boolean> => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - 5);
  const transaction = await manager.findOne(TransactionsEntity, {
    where: { status: 1, updateTime: now },
  });
  const pendingTransaction = await manager.findOne(TransactionsEntity, {
    where: { status: In([0, 2]) },
  });
  return !!transaction || !pendingTransaction;
};

export const isFaucetPendingTransactionToBig = async (manager: EntityManager, configService: ConfigService): Promise<boolean> => {
  const appState = await getAppStateByName(manager, AppStateNames.FAUCET_ACCOUNT_INDEX, false);
  const seedPhrase = configService.get<string>(CotiTransactionsEnvVariableNames.SEED_PHRASE);
  const wallet = HDNodeWallet.fromPhrase(seedPhrase, null, `m/44'/60'/0'/0`);
  const faucetWallet = wallet.derivePath(appState.value);
  const pendingTransactionCount = await manager.count(TransactionsEntity, {
    where: { from: faucetWallet.address, status: In([0, 2]) },
  });

  return pendingTransactionCount >= 5;
};
