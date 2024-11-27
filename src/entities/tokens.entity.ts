import { BaseEntity } from './base.entity';
import {
  Column,
  Entity,
  EntityManager,
  FindManyOptions,
  FindOptionsWhere,
  ManyToOne,
} from 'typeorm';
import { TableNames } from './table-names';
import { AccountsEntity } from './accounts.entity';
import { ActionsEntity } from './actions.entity';
import { ActionEnum } from '../enums/action.enum';

@Entity(TableNames.TOKENS)
export class TokensEntity extends BaseEntity {
  @Column()
  ownerAccountId: number;

  @Column()
  address: string;

  @Column()
  name: string;

  @Column()
  symbol: string;

  @Column()
  decimals: number;

  @Column()
  isBusiness: boolean;

  @Column()
  isPrivate: boolean;

  @ManyToOne(() => AccountsEntity, (account) => account.tokens)
  ownerAccount: AccountsEntity;
}

export const createTokenEntity = async (
  manager: EntityManager,
  token?: Partial<TokensEntity>,
): Promise<TokensEntity> => {
  const newToken = manager.create(TokensEntity, token);
  return manager.save(newToken);
};

export const getTokenWithOwnerAccount = async (
  manager: EntityManager,
  tokenId: number,
): Promise<TokensEntity> => {
  return manager.findOne(TokensEntity, {
    where: { id: tokenId },
    relations: ['ownerAccount'],
  });
};

export const getToken = async (
  manager: EntityManager,
  tokenId: number,
): Promise<TokensEntity> => {
  return manager.findOne(TokensEntity, {
    where: { id: tokenId },
  });
};

export const getTokensIds = async (
  manager: EntityManager,
  where: FindOptionsWhere<TokensEntity>,
  skip: number,
): Promise<number[]> => {
  const res = await manager
    .getRepository(TokensEntity)
    .createQueryBuilder('tokens')
    .select('tokens.id', 'id')
    .where(where)
    .skip(skip)
    .getRawMany<{ id: number }>();

  return res.map((x) => x.id);
};

export const getTokensCount = async (
  manager: EntityManager,
  params: FindOptionsWhere<TokensEntity>,
): Promise<number> => {
  return manager.count(TokensEntity, { where: params });
};

export const findTokens = async (
  manager: EntityManager,
  options: FindManyOptions<TokensEntity>,
): Promise<TokensEntity[]> => {
  return manager.find(TokensEntity, options);
};
