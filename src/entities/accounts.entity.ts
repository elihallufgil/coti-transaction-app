import { BaseEntity } from './base.entity';
import { Column, Entity } from 'typeorm';
import { TableNames } from './table-names';

@Entity(TableNames.WALLETS)
export class WalletsEntity extends BaseEntity {
  @Column()
  uuid: string;

  @Column()
  privateKey: string;
}
