import { utils } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";

import { SABER_ADDRESSES } from "../constants";

export const findRedeemerKey = async ({
  iouMint,
  redemptionMint,
}: {
  iouMint: PublicKey;
  redemptionMint: PublicKey;
}): Promise<[PublicKey, number]> => {
  return PublicKey.findProgramAddress(
    [
      utils.bytes.utf8.encode("Redeemer"),
      iouMint.toBytes(),
      redemptionMint.toBytes(),
    ],
    SABER_ADDRESSES.Redeemer
  );
};
