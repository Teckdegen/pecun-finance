"use client";

import { encodeFunctionData, parseAbi, type Address } from "viem";
import { chainClient, erc4626, evmVault, ExecError, registerAdapters, type Adapter, type Opp, type Proto } from "../execute";

/**
 * Avantis USDC vault (avUSDC, the junior tranche) on Base: ERC-4626 over USDC. Deposits can sit in a lock period, so
 * withdrawals go by maxRedeem / maxWithdraw (what's unlocked) and say so when nothing is unlocked yet.
 * The address is the vault manager's junior() on Base (TradingStorage 0x8a31…422d → vaultManager → junior).
 */

const BASE = 8453;
const AVANTIS_JUNIOR = "0x944766f715b51967E56aFdE5f0Aa76cEaCc9E7f9" as Address;
const ABI = parseAbi([
  "function maxRedeem(address) view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
]);

function avantisProto(): Proto {
  const base = erc4626(BASE, AVANTIS_JUNIOR);
  const read = (functionName: "maxRedeem" | "maxWithdraw", owner: Address) => chainClient(BASE).readContract({ address: AVANTIS_JUNIOR, abi: ABI, functionName, args: [owner] });
  return {
    ...base,
    withdraw: async (owner, amount) => {
      if (amount === "max") {
        const sh = await read("maxRedeem", owner);
        if (sh === BigInt(0)) throw new ExecError("Your Avantis deposit is still in its lock period. You can withdraw once it unlocks.");
        return { to: AVANTIS_JUNIOR, data: encodeFunctionData({ abi: ABI, functionName: "redeem", args: [sh, owner, owner] }) };
      }
      const free = await read("maxWithdraw", owner);
      if (free < amount) throw new ExecError(free === BigInt(0) ? "Your Avantis deposit is still in its lock period. You can withdraw once it unlocks." : "Part of your Avantis deposit is still locked. Withdraw a smaller amount, or wait for it to unlock.");
      return { to: AVANTIS_JUNIOR, data: encodeFunctionData({ abi: ABI, functionName: "withdraw", args: [amount, owner, owner] }) };
    },
  };
}

export function avantisAdapter(o: Opp): Adapter | null {
  return o.id === "avantis:8453:junior" ? evmVault(BASE, avantisProto(), "USDC") : null;
}

registerAdapters(avantisAdapter);
