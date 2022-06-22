import { utils } from "@project-serum/anchor";
import { getProgramAddress } from "@saberhq/solana-contrib";
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

export const getRedeemerKey = ({
  iouMint,
  redemptionMint,
}: {
  iouMint: PublicKey;
  redemptionMint: PublicKey;
}): PublicKey => {
  return getProgramAddress(
    [
      utils.bytes.utf8.encode("Redeemer"),
      iouMint.toBytes(),
      redemptionMint.toBytes(),
    ],
    SABER_ADDRESSES.Redeemer
  );
};
