import { Injectable, Logger } from '@nestjs/common';
import {
  Block,
  Filter,
  isAddress,
  JsonRpcProvider,
  Log,
  parseEther,
  Provider,
  Transaction,
  TransactionReceipt,
  TransactionResponse,
  Wallet,
  WebSocketProvider,
} from 'ethers';

import { OnboardInfo, Wallet as CotiWallet } from '@coti-io/coti-ethers';
import {
  ERC20__factory,
  ERC20Token__factory,
  PrivateERC20Token__factory,
} from '../typechain-types';
import { ConfigService } from '@nestjs/config';
import { CotiTransactionsEnvVariableNames } from '../types/env-validation.type';

@Injectable()
export class EthersService {
  private readonly logger = new Logger(EthersService.name);
  private readonly provider: Provider;
  private readonly websocketProvider: WebSocketProvider;
  private readonly onboardContractAddress: string;

  constructor(private readonly configService: ConfigService) {
    const rpcUrl = this.configService.get<string>(
      CotiTransactionsEnvVariableNames.COTI_RPC_URL,
    );
    const wsRpcUrl = this.configService.get<string>(
      CotiTransactionsEnvVariableNames.COTI_RPC_WEBSOCKET_URL,
    );
    const onboardContractAddress = this.configService.get<string>(
      CotiTransactionsEnvVariableNames.COTI_ONBOARD_CONTRACT_ADDRESS,
    );
    this.provider = new JsonRpcProvider(rpcUrl);
    this.websocketProvider = new WebSocketProvider(wsRpcUrl);
    this.onboardContractAddress = onboardContractAddress;
  }
  async getLatestBlock(): Promise<Block> {
    return this.provider.getBlock('latest');
  }

  async getBlockByNumber(
    blockNumber: number,
    prefetchTxs: boolean = false,
  ): Promise<Block> {
    return this.provider.getBlock(blockNumber, prefetchTxs);
  }

  async getBlockRange(
    fromBlockNumber: number,
    toBlockNumber: number,
    prefetchTxs: boolean = false,
  ): Promise<Block[]> {
    const blocksPromises = [];
    for (
      let blockNumber = fromBlockNumber;
      blockNumber <= toBlockNumber;
      blockNumber++
    ) {
      blocksPromises.push(this.provider.getBlock(blockNumber, prefetchTxs));
    }
    return await Promise.all(blocksPromises);
  }

  async getLogs(filter: Filter): Promise<Array<Log>> {
    return this.provider.getLogs(filter);
  }

  async getTransactionsReceipt(
    txHashes: string[],
  ): Promise<Map<string, TransactionReceipt>> {
    const result: Map<string, TransactionReceipt> = new Map<
      string,
      TransactionReceipt
    >();
    const transactionReceiptsPromises = [];
    for (const txHash of txHashes) {
      transactionReceiptsPromises.push(
        this.provider
          .getTransactionReceipt(txHash)
          .then((tr) => result.set(tr.hash, tr)),
      );
    }
    await Promise.all(transactionReceiptsPromises);
    return result;
  }

  async getBalance(address: string): Promise<bigint> {
    return this.provider.getBalance(address);
  }

  async getBalances(addresses: string[]): Promise<Map<string, bigint>> {
    const promises = [];
    const balanceMap = new Map<string, bigint>();
    for (const address of addresses) {
      promises.push(
        this.provider
          .getBalance(address)
          .then((x) => balanceMap.set(address, x)),
      );
    }
    await Promise.all(promises);
    return balanceMap;
  }

  async getErc20Details(contractAddress: string) {
    const erc20 = ERC20__factory.connect(contractAddress, this.provider);
    const details: { name: string; symbol: string; decimals: bigint } = {
      name: '',
      decimals: 0n,
      symbol: '',
    };
    const promises = [];
    promises.push(erc20.name().then((x) => (details.name = x)));
    promises.push(erc20.symbol().then((x) => (details.symbol = x)));
    promises.push(erc20.decimals().then((x) => (details.decimals = x)));
    await Promise.all(promises);
    return details;
  }

  async getErc20Balance(
    contractAddress: string,
    address: string,
  ): Promise<bigint> {
    const erc20 = ERC20__factory.connect(contractAddress, this.provider);
    return erc20['balanceOf(address)'](address);
  }

  async getPrivateErc20Balance(
    contractAddress: string,
    address: string,
  ): Promise<bigint> {
    const privateERC20 = PrivateERC20Token__factory.connect(
      contractAddress,
      this.provider,
    );
    return privateERC20['balanceOf(address)'](address);
  }

  async sendTransaction(transaction: Transaction): Promise<string> {
    const serializedTransaction = '0x' + transaction.serialized;
    return (await this.provider.broadcastTransaction(serializedTransaction))
      .hash;
  }

  async getTransaction(hash: string): Promise<TransactionResponse> {
    return this.provider.getTransaction(hash);
  }

  /**
   * Sends Ethereum to a specified address.
   * @param privateKey - The private key of the sender's wallet.
   * @param recipientAddress - The Ethereum address of the recipient.
   * @param amountInEth - The amount of Ethereum to send (in ETH).
   * @returns A promise that resolves to the transaction hash.
   */
  async sendEthereum(
    privateKey: string,
    recipientAddress: string,
    amountInEth: string,
  ): Promise<TransactionResponse> {
    try {
      // Create a wallet instance using the private key and connect to the provider
      const wallet = new Wallet(privateKey, this.provider);

      // Validate the recipient address
      if (!isAddress(recipientAddress)) {
        throw new Error('Invalid recipient address');
      }

      // Convert the ETH amount to Wei (the smallest unit of ETH)
      const amountInWei = parseEther(amountInEth);
      // check if we have the balance
      const fromBalance = await this.getBalance(wallet.address);
      if (fromBalance < amountInWei) {
        throw new Error('Not enough balance');
      }
      // Create and send the transaction
      return await wallet.sendTransaction({
        to: recipientAddress,
        value: amountInWei, // Amount in Wei
      });
    } catch (error) {
      console.error('Error sending Ethereum:', error);
      throw error;
    }
  }

  async onboard(privateKey: string): Promise<OnboardInfo | undefined> {
    // Set up the provider and wallet
    const wallet = new CotiWallet(privateKey, this.provider);
    await wallet.generateOrRecoverAes();
    return wallet.getUserOnboardInfo();
  }

  async getTransactionResponse(
    txHash: string,
  ): Promise<TransactionResponse | null> {
    try {
      // Validate the transaction hash
      if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) {
        throw new Error('Invalid transaction hash');
      }

      // Fetch the transaction response
      const txResponse = await this.provider.getTransaction(txHash);

      if (!txResponse) {
        return null;
      }

      return txResponse;
    } catch (error) {
      console.error('Error fetching transaction response:', error);
      throw error;
    }
  }

  async getTransactionReceipt(
    txHash: string,
  ): Promise<TransactionReceipt | null> {
    try {
      // Validate the transaction hash
      if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) {
        throw new Error('Invalid transaction hash');
      }

      // Fetch the transaction response
      const txReceipt = await this.provider.getTransactionReceipt(txHash);

      if (!txReceipt) {
        return null;
      }

      return txReceipt;
    } catch (error) {
      console.error('Error fetching transaction response:', error);
      throw error;
    }
  }

  async deployToken(params: {
    privateKey: string;
    tokenName: string;
    tokenSymbol: string;
    decimals: number;
    owner: string;
    isPrivate: boolean;
  }) {
    const { privateKey, tokenName, tokenSymbol, decimals, owner, isPrivate } =
      params;
    const wallet = new Wallet(privateKey, this.provider);

    if (!isPrivate) {
      const tokenFactory = new ERC20Token__factory(wallet);
      return tokenFactory.deploy(tokenName, tokenSymbol, decimals, owner);
    } else {
      const tokenFactory = new PrivateERC20Token__factory(wallet);
      return tokenFactory.deploy(tokenName, tokenSymbol, decimals, owner);
    }
  }
}
