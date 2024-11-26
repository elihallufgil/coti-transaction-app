import { BaseEntity } from './base.entity';
import { Column, Entity, EntityManager, In, IsNull, OneToMany } from 'typeorm';
import { TableNames } from './table-names';
import { exec } from '../utils/helpers';
import { AppStatesEntity } from './app-states.entity';
import { TokensEntity } from './tokens.entity';

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

  @OneToMany(() => TokensEntity, (token) => token.ownerAccount)
  tokens: TokensEntity[];
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

export const getAccountByIndex = async (
  manager: EntityManager,
  index: number,
): Promise<AccountsEntity> => {
  return manager.findOne(AccountsEntity, { where: { index } });
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
