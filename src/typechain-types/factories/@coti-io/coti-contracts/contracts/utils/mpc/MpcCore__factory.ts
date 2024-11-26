/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import {
  Contract,
  ContractFactory,
  ContractTransactionResponse,
  Interface,
} from "ethers";
import type { Signer, ContractDeployTransaction, ContractRunner } from "ethers";
import type { NonPayableOverrides } from "../../../../../../common";
import type {
  MpcCore,
  MpcCoreInterface,
} from "../../../../../../@coti-io/coti-contracts/contracts/utils/mpc/MpcCore";

const _abi = [
  {
    inputs: [],
    name: "RSA_SIZE",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const _bytecode =
  "0x60be610052600b82828239805160001a607314610045577f4e487b7100000000000000000000000000000000000000000000000000000000600052600060045260246000fd5b30600052607381538281f3fe730000000000000000000000000000000000000000301460806040526004361060335760003560e01c806331b943d5146038575b600080fd5b603e6052565b60405160499190606f565b60405180910390f35b61010081565b6000819050919050565b6069816058565b82525050565b6000602082019050608260008301846062565b9291505056fea264697066735822122045a346b4eedd6af635b4430bd1f465c9c64a1f8cf0a0c5686a79de97d30653eb64736f6c63430008130033";

type MpcCoreConstructorParams =
  | [signer?: Signer]
  | ConstructorParameters<typeof ContractFactory>;

const isSuperArgs = (
  xs: MpcCoreConstructorParams
): xs is ConstructorParameters<typeof ContractFactory> => xs.length > 1;

export class MpcCore__factory extends ContractFactory {
  constructor(...args: MpcCoreConstructorParams) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
  }

  override getDeployTransaction(
    overrides?: NonPayableOverrides & { from?: string }
  ): Promise<ContractDeployTransaction> {
    return super.getDeployTransaction(overrides || {});
  }
  override deploy(overrides?: NonPayableOverrides & { from?: string }) {
    return super.deploy(overrides || {}) as Promise<
      MpcCore & {
        deploymentTransaction(): ContractTransactionResponse;
      }
    >;
  }
  override connect(runner: ContractRunner | null): MpcCore__factory {
    return super.connect(runner) as MpcCore__factory;
  }

  static readonly bytecode = _bytecode;
  static readonly abi = _abi;
  static createInterface(): MpcCoreInterface {
    return new Interface(_abi) as MpcCoreInterface;
  }
  static connect(address: string, runner?: ContractRunner | null): MpcCore {
    return new Contract(address, _abi, runner) as unknown as MpcCore;
  }
}