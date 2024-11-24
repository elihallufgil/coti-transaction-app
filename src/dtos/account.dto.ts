import { AccountsEntity } from '../entities';
import { IsInt, IsNumber, IsNumberString, Min } from 'class-validator';

export class PickRandomAccountsToSendCotiRequest {
  @IsInt()
  count: number;
}

export class PickRandomAccountsToSendCotiResponse {
  accountsIndexes: number[];
}
export class SendCotiFromFaucetRequest {
  @IsNumber()
  toIndex: number;
  @IsNumberString()
  amountInCoti: string;
}

export class SendCotiFromAccountToAccountRequest {
  @Min(1)
  @IsNumber()
  fromIndex: number;
  @Min(1)
  @IsNumber()
  toIndex: number;
  @IsNumberString()
  amountInCoti: string;
}

export class OnboardAccountRequest {
  @Min(1)
  @IsNumber()
  index: number;
}
export class AccountResponse {
  id: number;
  index: number;
  networkAesKey: string;
  privateKey: string;
  address: string;
  createTime: Date;
  updateTime: Date;
  constructor(accountEntity: AccountsEntity) {
    this.id = accountEntity.id;
    this.index = accountEntity.index;
    this.networkAesKey = accountEntity.networkAesKey;
    this.privateKey = accountEntity.privateKey;
    this.address = accountEntity.address;
    this.createTime = accountEntity.createTime;
    this.updateTime = accountEntity.updateTime;
  }
}
