import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import {
  AccountResponse,
  CreateTokenRequest,
  GetTokenBalanceRequest,
  MintTokenToAccountRequest,
  OnboardAccountRequest,
  PickRandomAccountsToSendCotiRequest,
  PickRandomAccountsToSendCotiResponse,
  SendCotiFromAccountToAccountRequest,
  SendCotiFromFaucetRequest,
  TokenBalanceResponse,
  TokenResponse,
  TransferTokenToAccountRequest,
} from './dtos/account.dto';
import { TransactionResponse } from 'ethers';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('create-account')
  async createAccount(): Promise<AccountResponse> {
    return this.appService.createAccount();
  }

  @Post('create-token')
  async createToken(@Body() body: CreateTokenRequest): Promise<TokenResponse> {
    return this.appService.createNewToken(body);
  }

  @Post('send-coti-from-faucet')
  async sendCotiFromFaucet(
    @Body() body: SendCotiFromFaucetRequest,
  ): Promise<TransactionResponse> {
    return this.appService.sendCotiFromFaucet(body);
  }

  @Post('mint-token')
  async mintToken(
    @Body() body: MintTokenToAccountRequest,
  ): Promise<TransactionResponse> {
    return this.appService.mintToken(body);
  }

  @Post('transfer-token')
  async transferToken(
    @Body() body: TransferTokenToAccountRequest,
  ): Promise<TransactionResponse> {
    return this.appService.transferToken(body);
  }

  @Post('onboard')
  async onboardAccount(
    @Body() body: OnboardAccountRequest,
  ): Promise<TransactionResponse> {
    return this.appService.onboardAccount(body);
  }

  @Post('pick-random-accounts-to-send-coti')
  async pickRandomAccountsToSendCoti(
    @Body() body: PickRandomAccountsToSendCotiRequest,
  ): Promise<PickRandomAccountsToSendCotiResponse> {
    return this.appService.pickRandomAccountsToSendCoti(body);
  }

  @Post('send-from-account-to-account')
  async sendCotiFromAccountToAccount(
    @Body() body: SendCotiFromAccountToAccountRequest,
  ): Promise<TransactionResponse> {
    return this.appService.sendCotiFromAccountToAccount(body);
  }

  @Post('get-token-balance')
  async getTokenBalance(
    @Body() body: GetTokenBalanceRequest,
  ): Promise<TokenBalanceResponse> {
    return this.appService.getTokenBalance(body);
  }
}
