import { BaseEntity } from './base.entity';
import { Column, Entity } from 'typeorm';
import { TableNames } from './table-names';

@Entity(TableNames.ACCOUNTS)
export class AccountsEntity extends BaseEntity {
  @Column()
  uuid: string;

  @Column()
  index: number;

  @Column()
  networkAesKey: string;

  @Column()
  privateKey: string;

  @Column()
  address: string;
}
