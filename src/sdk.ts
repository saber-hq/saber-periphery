import { newProgramMap } from "@saberhq/anchor-contrib";
import type {
  AugmentedProvider,
  Provider,
  TransactionEnvelope,
} from "@saberhq/solana-contrib";
import { SolanaAugmentedProvider } from "@saberhq/solana-contrib";
import type { Signer, TransactionInstruction } from "@solana/web3.js";

import { SABER_ADDRESSES, SABER_IDLS } from ".";
import type { SaberPrograms } from "./constants";
import type { PendingRedeemer, RedeemerWrapperCtorArgs } from "./redeemer";
import { RedeemerWrapper } from "./redeemer/wrapper";
import { Router } from "./router";
import { MintProxyWrapper } from "./wrappers";
import { LockupWrapper } from "./wrappers/lockup";

export const SBR_ADDRESS = "Saber2gLauYim4Mvftnrasomsv6NvAuncvMEZwcLpD1";

/**
 * Saber SDK.
 */
export class Saber {
  readonly router: Router;

  constructor(
    readonly provider: AugmentedProvider,
    readonly programs: SaberPrograms
  ) {
    this.router = new Router(provider, programs);
  }

  /**
   * Creates a new instance of the SDK with the given keypair.
   */
  withSigner(signer: Signer): Saber {
    return Saber.load({
      provider: this.provider.withSigner(signer),
    });
  }

  /**
   * Mint proxy helpers.
   */
  get mintProxy(): MintProxyWrapper {
    return new MintProxyWrapper(this);
  }

  /**
   * Lockup helpers.
   */
  get lockup(): LockupWrapper {
    return new LockupWrapper(this);
  }

  /**
   * Constructs a new transaction envelope.
   * @param instructions
   * @param signers
   * @returns
   */
  newTx(
    instructions: TransactionInstruction[],
    signers?: Signer[]
  ): TransactionEnvelope {
    return this.provider.newTX(instructions, signers);
  }

  async loadRedeemer(
    ctorArgs: Omit<RedeemerWrapperCtorArgs, "sdk">
  ): Promise<RedeemerWrapper> {
    return await RedeemerWrapper.load({ ...ctorArgs, sdk: this });
  }

  async createRedeemer(
    ctorArgs: Omit<RedeemerWrapperCtorArgs, "sdk">
  ): Promise<PendingRedeemer> {
    return await RedeemerWrapper.createRedeemer({ ...ctorArgs, sdk: this });
  }

  /**
   * Loads the SDK.
   * @returns
   */
  static load({
    provider,
  }: {
    // Provider
    provider: Provider;
  }): Saber {
    const programs = newProgramMap<SaberPrograms>(
      provider,
      SABER_IDLS,
      SABER_ADDRESSES
    );
    return new Saber(new SolanaAugmentedProvider(provider), programs);
  }
}
