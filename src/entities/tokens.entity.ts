import { BaseEntity } from './base.entity';
import { Column, Entity, EntityManager, JoinColumn, OneToMany } from 'typeorm';
import { TableNames } from './table-names';
import { exec } from '@app/shared/utils';
import { UserWalletTokensEntity } from '@app/shared/entities';

@Entity(TableNames.TOKENS)
export class TokensEntity extends BaseEntity {
  @Column()
  networkId: number;

  @Column()
  address: string;

  @Column()
  name: string;

  @Column()
  symbol: string;

  @Column()
  decimals: number;

  @Column()
  imageUrl: string;

  @Column()
  isDefault: boolean;

  @Column()
  isPrivate: boolean;

  @OneToMany(() => UserWalletTokensEntity, userWalletToken => userWalletToken.token)
  @JoinColumn({ name: 'id', referencedColumnName: 'tokenId' })
  userWalletTokens: UserWalletTokensEntity[];
}

export const getUserWalletTokens = async (manager: EntityManager, walletUuid: string): Promise<UserWalletTokensEntity[]> => {
  const [userWalletTokensError, userWalletTokens] = await exec(
    manager
      .getRepository<UserWalletTokensEntity>(TableNames.USER_WALLET_TOKENS)
      .createQueryBuilder(TableNames.USER_WALLET_TOKENS)
      .innerJoinAndSelect(`${TableNames.USER_WALLET_TOKENS}.userWallet`, 'userWallet')
      .innerJoinAndSelect(`${TableNames.USER_WALLET_TOKENS}.token`, 'token')
      .where(`userWallet.uuid = :uuid`, { uuid: walletUuid })
      .getMany(),
  );
  if (userWalletTokensError) throw userWalletTokensError;
  return userWalletTokens;
};
