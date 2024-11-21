import { Column, Entity, EntityManager, In, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { CotiBlocksEntity } from './coti-blocks.entity';
import { TableNames } from '../table-names';
import { exec } from '../../utils';
import { Block, TransactionReceipt, TransactionResponseParams } from 'ethers';
import { CotiLogsEntity } from './coti-logs.entity';
import { CotiActivitiesEntity } from './coti-activities.entity';
import { Logger } from '@nestjs/common';

@Entity(TableNames.COTI_TRANSACTIONS)
export class CotiTransactionsEntity extends BaseEntity {
  @Column()
  blockId: number;

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

  @ManyToOne(() => CotiBlocksEntity, block => block.transactions)
  @JoinColumn({ name: 'blockId' })
  block: CotiBlocksEntity;
  @OneToMany(() => CotiLogsEntity, log => log.transaction)
  @JoinColumn({ name: 'transactionId' })
  logs: CotiLogsEntity[];
  @OneToMany(() => CotiActivitiesEntity, activity => activity.transaction)
  @JoinColumn({ name: 'transactionId' })
  activities: CotiActivitiesEntity[];
}

export const getCotiTransactionsByBlockId = async (manager: EntityManager, blockId: number): Promise<CotiTransactionsEntity[]> => {
  const [txsError, txs] = await exec(manager.getRepository<CotiTransactionsEntity>(TableNames.COTI_TRANSACTIONS).createQueryBuilder().where({ blockId }).getMany());
  if (txsError) throw txsError;
  return txs;
};

export function createTransaction(manager: EntityManager, blockId: number, transaction: TransactionResponseParams, receipt: TransactionReceipt): CotiTransactionsEntity {
  return manager.create(CotiTransactionsEntity, {
    blockId,
    from: transaction.from,
    to: transaction.to,
    hash: transaction.hash,
    maxFeePerGas: transaction.maxFeePerGas?.toString(),
    data: transaction.data,
    type: transaction.type,
    gasLimit: transaction.gasLimit?.toString(),
    gasPrice: transaction.gasPrice?.toString(),
    value: transaction.value?.toString(),
    nonce: transaction.nonce,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toString(),
    index: transaction.index,
    status: receipt.status,
    gasUsed: receipt.gasUsed?.toString(),
  });
}

export async function insertBlockTransactions(
  manager: EntityManager,
  blockId: number,
  transactions: ReadonlyArray<TransactionResponseParams>,
  transactionsReceipts: TransactionReceipt[],
): Promise<CotiTransactionsEntity[]> {
  const txHashToReceiptMap: Map<string, TransactionReceipt> = new Map<string, TransactionReceipt>();
  for (const receipt of transactionsReceipts) {
    txHashToReceiptMap.set(receipt.hash, receipt);
  }
  const cotiTransactionsEntities = transactions.map(t => createTransaction(manager, blockId, t, txHashToReceiptMap.get(t.hash)));
  return manager.save(cotiTransactionsEntities);
}

export async function insertBlocksTransactions(
  manager: EntityManager,
  blocks: Block[],
  blocksEntities: CotiBlocksEntity[],
  transactionsReceiptsMap: Map<string, TransactionReceipt>,
): Promise<CotiTransactionsEntity[]> {
  const logger = new Logger('insertBlocksTransactions');
  const transactionsToSave: CotiTransactionsEntity[] = [];
  blocks.sort((a, b) => a.number - b.number);
  for (const block of blocks) {
    const blockId = blocksEntities.find(b => b.index === block.number)?.id;
    if (!blockId && blockId !== 0) throw new Error('[insertBlocksTransactions][Missing block entity]');
    transactionsToSave.push(...block.prefetchedTransactions.map(t => createTransaction(manager, blockId, t, transactionsReceiptsMap.get(t.hash))));
  }
  if (!transactionsToSave.length) return [];
  const newTransactions = await manager.insert(CotiTransactionsEntity, transactionsToSave);
  logger.log(`Inserted ${transactionsToSave.length} transactions`);
  const ids = newTransactions.identifiers.map(i => i.id);
  return manager.find(CotiTransactionsEntity, { where: { id: In(ids) } });
}
