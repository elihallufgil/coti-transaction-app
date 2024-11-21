import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Block, Filter, Log, Provider, Transaction, TransactionLike, TransactionReceipt, TransactionResponse, Wallet } from 'ethers';
import { ProviderData } from '@app/shared/types/ethers.type';
import { AccountOnboard__factory, ERC20__factory, PrivateERC20__factory } from '@app/shared/typechain-types';
import { TransactionDto } from '../../../../../apps/zimzam-api/src/dtos/network.dto';
import { AccountOnboardedEvent } from '@app/shared/typechain-types/AccountOnboard';
import { recoverUserKey } from '@coti-io/coti-sdk-typescript';

@Injectable()
export class EthersService {
  private readonly logger = new Logger(EthersService.name);
  private initialized = false;
  private providerDataMap: Map<number, ProviderData>;

  init(providerDataMap: Map<number, ProviderData>) {
    if (this.initialized) {
      throw new Error('Initialized provider data.');
    }
    this.providerDataMap = providerDataMap;
    this.logger.log(`[init][EthersService initialized with ${providerDataMap.size} provider]`);
    this.initialized = true;
  }

  getProvider(chainId?: number): Provider {
    return chainId ? this.providerDataMap.get(chainId).provider : this.providerDataMap.entries().next().value[1].provider;
  }

  async getLatestBlock(chainId?: number): Promise<Block> {
    return this.getProvider(chainId).getBlock('latest');
  }

  async getBlockByNumber(blockNumber: number, prefetchTxs: boolean = false, chainId?: number): Promise<Block> {
    return this.getProvider(chainId).getBlock(blockNumber, prefetchTxs);
  }

  async getBlockRange(fromBlockNumber: number, toBlockNumber: number, prefetchTxs: boolean = false, chainId?: number): Promise<Block[]> {
    const blocksPromises = [];
    for (let blockNumber = fromBlockNumber; blockNumber <= toBlockNumber; blockNumber++) {
      blocksPromises.push(this.getProvider(chainId).getBlock(blockNumber, prefetchTxs));
    }
    return await Promise.all(blocksPromises);
  }

  async getLogs(filter: Filter, chainId?: number): Promise<Array<Log>> {
    return this.getProvider(chainId).getLogs(filter);
  }

  async getTransactionReceipt(txHash: string, chainId?: number): Promise<TransactionReceipt> {
    return this.getProvider(chainId).getTransactionReceipt(txHash);
  }

  async getTransactionsReceipt(txHashes: string[], chainId?: number): Promise<Map<string, TransactionReceipt>> {
    const result: Map<string, TransactionReceipt> = new Map<string, TransactionReceipt>();
    const transactionReceiptsPromises = [];
    for (const txHash of txHashes) {
      transactionReceiptsPromises.push(
        this.getProvider(chainId)
          .getTransactionReceipt(txHash)
          .then(tr => result.set(tr.hash, tr)),
      );
    }
    await Promise.all(transactionReceiptsPromises);
    return result;
  }

  async getBalance(address: string, chainId?: number): Promise<bigint> {
    return this.getProvider(chainId).getBalance(address);
  }

  async getErc20Details(contractAddress: string, chainId?: number) {
    const erc20 = ERC20__factory.connect(contractAddress, this.getProvider(chainId));
    const details: { name: string; symbol: string; decimals: bigint } = { name: '', decimals: 0n, symbol: '' };
    const promises = [];
    promises.push(erc20.name().then(x => (details.name = x)));
    promises.push(erc20.symbol().then(x => (details.symbol = x)));
    promises.push(erc20.decimals().then(x => (details.decimals = x)));
    await Promise.all(promises);
    return details;
  }

  async isPrivateErc20(contractAddress: string, chainId?: number) {
    const privateERC20 = PrivateERC20__factory.connect(contractAddress, this.getProvider(chainId));
    try {
      await privateERC20['accountEncryptionAddress(address)'](contractAddress);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getErc20Balance(contractAddress: string, address: string, chainId?: number): Promise<bigint> {
    const erc20 = ERC20__factory.connect(contractAddress, this.getProvider(chainId));
    return erc20['balanceOf(address)'](address);
  }

  async getPrivateErc20Balance(contractAddress: string, address: string, chainId?: number): Promise<bigint> {
    const privateERC20 = PrivateERC20__factory.connect(contractAddress, this.getProvider(chainId));
    return privateERC20['balanceOf(address)'](address);
  }

  async sendTransaction(transaction: Transaction, chainId?: number): Promise<string> {
    const serializedTransaction = '0x' + transaction.serialized;
    return (await this.getProvider(chainId).broadcastTransaction(serializedTransaction)).hash;
  }

  async getTransaction(hash: string, chainId?: number): Promise<TransactionResponse> {
    return this.getProvider(chainId).getTransaction(hash);
  }

  parseTransactionFromDto(transactionDto: TransactionDto): Transaction {
    const transaction = new Transaction();
    transaction.type = transactionDto.type;
    transaction.chainId = transactionDto.chainId;
    transaction.value = transactionDto.value;
    transaction.gasPrice = transactionDto.gasPrice;
    transaction.maxPriorityFeePerGas = transactionDto.maxPriorityFeePerGas;
    transaction.maxFeePerGas = transactionDto.maxFeePerGas;
    transaction.data = transactionDto.data;
    transaction.nonce = transactionDto.nonce;
    transaction.gasLimit = transactionDto.gasLimit;
    transaction.signature = transactionDto.sig;
    if (transaction.from !== transactionDto.from) {
      throw new BadRequestException(`Invalid transaction from`);
    }
    return transaction;
  }

  async onboardAccount(
    accountOnboardContractAddress: string,
    rsaKeys: {
      publicKey: Uint8Array;
      privateKey: Uint8Array;
    },
    signature: Uint8Array,
    signer: Wallet,
    transactionLike: TransactionLike,
  ): Promise<{ aesKey: string; txHash: string }> {
    const accountOnboard = AccountOnboard__factory.connect(accountOnboardContractAddress, signer);
    const receipt = await (await accountOnboard.getFunction('onboardAccount')(rsaKeys.publicKey, signature, transactionLike)).wait(1, 10000);

    const accountOnboardedEventLog = receipt?.logs?.shift();
    if (!accountOnboardedEventLog) {
      throw new Error('Failed to onboard account');
    }

    const decodedLog = accountOnboard.interface.parseLog(accountOnboardedEventLog) as unknown as AccountOnboardedEvent.LogDescription;

    const userKey1 = decodedLog.args.userKey1.substring(2);
    const userKey2 = decodedLog.args.userKey2.substring(2);

    return {
      aesKey: recoverUserKey(rsaKeys.privateKey, userKey1, userKey2),
      txHash: receipt.hash,
    };
  }
}
