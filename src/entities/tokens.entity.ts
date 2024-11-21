import { BaseEntity } from './base.entity';
import { Column, Entity } from 'typeorm';
import { TableNames } from './table-names';

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
}
