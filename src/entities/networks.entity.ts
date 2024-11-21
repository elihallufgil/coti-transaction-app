import { BaseEntity } from './base.entity';
import { Column, Entity } from 'typeorm';
import { TableNames } from './table-names';

@Entity(TableNames.NETWORKS)
export class NetworksEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ unique: true })
  chainId: number;

  @Column()
  networkId: number;

  @Column()
  nativeTokenName: string;

  @Column()
  nativeTokenSymbol: string;

  @Column()
  nativeTokenDecimals: number;

  @Column()
  rpcUrl: string;

  @Column()
  wsUrl: string;

  @Column()
  explorerUrl: string;

  @Column()
  imageUrl: string;

  @Column()
  cotiMonitorApiUrl: string;

  @Column()
  cotiMonitorApiKey: string;

  @Column()
  isActive: boolean;

  @Column()
  isDefault: boolean;
}
