import { BaseEntity } from './base.entity';
import {
  Column,
  Entity,
  EntityManager,
  In,
  IsNull,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { TableNames } from './table-names';
import { TokensEntity } from './tokens.entity';
import { ActivitiesEntity } from './activities.entity';
import { TransactionsEntity } from './transactions.entity';

@Entity(TableNames.ACCOUNTS)
export class AccountsEntity extends BaseEntity {
  @Column()
  index: number;

  @Column()
  networkAesKey: string;

  @Column()
  privateKey: string;

  @Column()
  address: string;

  @Column()
  isStuck: boolean;

  @OneToMany(() => TokensEntity, (token) => token.ownerAccount)
  tokens: TokensEntity[];

  @OneToMany(() => ActivitiesEntity, (activity) => activity.toAccount)
  @JoinColumn({ name: 'address', referencedColumnName: 'to' })
  toActivities: ActivitiesEntity[];
}

export const createAccountEntity = async (
  manager: EntityManager,
  account?: Partial<AccountsEntity>,
): Promise<AccountsEntity> => {
  const newAccount = manager.create(AccountsEntity, account);
  return manager.save(newAccount);
};

export const getAccountCount = async (
  manager: EntityManager,
): Promise<number> => {
  return manager.count(AccountsEntity);
};

export const getAccountsByIndexes = async (
  manager: EntityManager,
  indexes: number[],
): Promise<AccountsEntity[]> => {
  return manager.find(AccountsEntity, { where: { index: In(indexes) } });
};

export const getAccountsByIds = async (
  manager: EntityManager,
  ids: number[],
): Promise<AccountsEntity[]> => {
  return manager.find(AccountsEntity, { where: { index: In(ids) } });
};

export const getAccountsByAddresses = async (
  manager: EntityManager,
  addresses: string[],
): Promise<AccountsEntity[]> => {
  return manager.find(AccountsEntity, { where: { address: In(addresses) } });
};

export const getAccountByIndex = async (
  manager: EntityManager,
  index: number,
): Promise<AccountsEntity> => {
  return manager.findOne(AccountsEntity, { where: { index } });
};

export const getAccountByAddress = async (
  manager: EntityManager,
  address: string,
): Promise<AccountsEntity> => {
  return manager.findOne(AccountsEntity, { where: { address } });
};

export const getAccountByToken = async (
  manager: EntityManager,
  tokenId: number,
): Promise<AccountsEntity> => {
  const token = await manager.findOne(TokensEntity, {
    where: { id: tokenId },
    relations: ['ownerAccount'],
  });
  return token.ownerAccount;
};

export const getAccountsToOnboard = async (
  manager: EntityManager,
  take: number,
): Promise<AccountsEntity[]> => {
  return manager.find(AccountsEntity, {
    where: { networkAesKey: IsNull() },
    take,
  });
};

export const getAccountsNonce = async (
  manager: EntityManager,
  indexes: number[],
): Promise<
  Map<
    number,
    {
      index: number;
      maxStuckNonce: number;
      maxPendingNonce: number;
      maxCompletedNonce: number;
    }
  >
> => {
  const accountsRepository = manager.getRepository(AccountsEntity);
  const resMap = new Map<
    number,
    {
      index: number;
      maxStuckNonce: number;
      maxPendingNonce: number;
      maxCompletedNonce: number;
    }
  >();
  const res = await accountsRepository
    .createQueryBuilder('accounts')
    .leftJoin(
      TransactionsEntity,
      'transactions',
      'accounts.address = transactions.from',
    )
    .select('accounts.index', 'index')
    .addSelect(
      'MAX(CASE WHEN transactions.status = 2 THEN transactions.nonce ELSE NULL END)',
      'maxStuckNonce',
    )
    .addSelect(
      'MAX(CASE WHEN transactions.status = 1 THEN transactions.nonce ELSE NULL END)',
      'maxPendingNonce',
    )
    .addSelect(
      'MAX(CASE WHEN transactions.status = 1 THEN transactions.nonce ELSE NULL END)',
      'maxCompletedNonce',
    )
    .where({ index: In(indexes) })
    .andWhere('transactions.isCanceled = false')
    .groupBy('accounts.index')
    .getRawMany<{
      index: number;
      maxStuckNonce: number;
      maxPendingNonce: number;
      maxCompletedNonce: number;
    }>();

  for (const row of res) {
    resMap.set(row.index, row);
  }
  return resMap;
};
