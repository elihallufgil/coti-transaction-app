import { AccountsEntity, TokensEntity } from '../entities';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class PickRandomAccountsToSendCotiRequest {
  @IsInt()
  count: number;

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  banIndexList?: number[];
}

export class GetFaucetWalletAddressResponse {
  address: string;
  nonce: number;
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

export class CreateTokenRequest {
  @IsNumber()
  accountIndex: number;
  @IsOptional()
  @IsString()
  name?: string;
  @IsOptional()
  @IsString()
  symbol?: string;
  @IsNumber()
  decimals: number;
  @IsBoolean()
  isPrivate: boolean;
  @IsBoolean()
  isBusiness: boolean;
}

export class TokenResponse {
  id: number;
  ownerAccountId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  isBusiness: boolean;
  isPrivate: boolean;
  createTime: Date;
  updateTime: Date;
  constructor(tokenEntity: TokensEntity) {
    this.id = tokenEntity.id;
    this.ownerAccountId = tokenEntity.ownerAccountId;
    this.address = tokenEntity.address;
    this.name = tokenEntity.name;
    this.symbol = tokenEntity.symbol;
    this.decimals = tokenEntity.decimals;
    this.isBusiness = tokenEntity.isBusiness;
    this.isPrivate = tokenEntity.isPrivate;
    this.createTime = tokenEntity.createTime;
    this.updateTime = tokenEntity.updateTime;
  }
}

export class MintTokenToAccountRequest {
  @Min(0)
  @IsNumber()
  tokenId: number;
  @Min(0)
  @IsNumber()
  toIndex: number;
  @IsNumberString()
  tokenAmountInWei: string;
}

export class TransferTokenToAccountRequest {
  @Min(0)
  @IsNumber()
  tokenId: number;
  @Min(0)
  @IsNumber()
  toIndex: number;
  @IsNumber()
  fromIndex: number;
  @IsNumberString()
  tokenAmountInWei: string;
}

export class GetTokenBalanceRequest {
  @Min(0)
  @IsNumber()
  tokenId: number;
  @Min(0)
  @IsNumber()
  accountIndex: number;
}

export class TokenBalanceResponse {
  account: AccountResponse;
  token: TokenResponse;
  balance: string;
  constructor(
    accountEntity: AccountsEntity,
    tokenEntity: TokensEntity,
    balance: string,
  ) {
    this.account = new AccountResponse(accountEntity);
    this.token = new TokenResponse(tokenEntity);
    this.balance = balance;
  }
}
