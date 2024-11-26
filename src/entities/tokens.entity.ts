import { BaseEntity } from './base.entity';
import { Column, Entity, EntityManager, ManyToOne } from 'typeorm';
import { TableNames } from './table-names';
import { AccountsEntity } from './accounts.entity';

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
