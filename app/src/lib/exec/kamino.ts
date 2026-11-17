"use client";

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { formatUnits, parseUnits } from "viem";
import { ExecError, IN_STEPS, OUT_STEPS, registerAdapters, sendSol, waitForArrival, type Adapter, type Opp } from "../execute";
import { solana, splBalance } from "../solana";
import {
  ata,
  buildTx,
  bytes,
  closeAccountIx,
  computeLimitIx,
  createAtaIx,
  fromSolana,
  hexBytes,
  isNullKey,
  needSol,
  pk,
  previewFromSolana,
  previewToSolana,
  readKey,
  readU128,
  readU64,
  seed,
  solBalance,
  spendableSol,
  SYSVAR_INSTRUCTIONS,
  SYSVAR_RENT,
  timeout,
  toSolana,
  TOKEN_PROGRAM,
  u128le,
  u64le,
  unwrapSolIx,
  WSOL,
  wrapSolIxs,
} from "./solana-kit";

/**
 * Kamino on Solana, built straight from Kamino's programs (Kamino's transaction API has no CORS, so it can't be called
 * from the browser).
 *
 * - Lending reserves (kamino:solana:<reserve>): supplies through klend's `deposit_reserve_liquidity`, so the user holds
 *   the reserve's kTokens (collateral tokens) in their wallet; they earn the supply rate through the kToken exchange
 *   rate and are redeemed with `redeem_reserve_collateral`. No obligation account, no borrowing.
 * - Earn vaults (kamino:solana:kv:<vault>): kvault `deposit` / `withdraw_from_available`, with the shares staked in
 *   the vault's farm (like Kamino's own app) so the farm rewards accrue; unstaked again on withdrawal.
 */

const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const KVAULT = new PublicKey("KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd");
const FARMS = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
const KAMINO_API = "https://api.kamino.finance";
const KLEND_NULL = new PublicKey("nu11111111111111111111111111111111111111111");
const SF = BigInt(1) << BigInt(60); // klend's fixed-point scale
const FARM_SCALE = BigInt(10) ** BigInt(18);
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const ZERO = BigInt(0);

const ix = (programId: PublicKey, keys: [PublicKey, boolean, boolean][], data: Uint8Array) =>
  new TransactionInstruction({ programId, keys: keys.map(([pubkey, isWritable, isSigner]) => ({ pubkey, isWritable, isSigner })), data: data as Buffer });

/* ---------------- klend reserves ---------------- */

type Reserve = {
  address: PublicKey;
  market: PublicKey;
  liqMint: PublicKey;
  liqSupply: PublicKey;
  liqProgram: PublicKey;
  decimals: number;
  collMint: PublicKey;
  collSupply: bigint;
  /** Total liquidity the kTokens are a claim on, in the asset's smallest units × 2^60. */
  totalSf: bigint;
  oracles: [PublicKey, PublicKey, PublicKey, PublicKey]; // pyth, switchboard price, switchboard twap, scope
  depositLimit: bigint;
  /** Liquidity sitting in the reserve (not lent out). */
  available: bigint;
  /** 0 active, 1 obsolete, 2 hidden. */
  status: number;
};

/** Reads a reserve straight from chain (layout of klend's `Reserve` account). */
async function readReserve(address: PublicKey): Promise<Reserve> {
  const a = await solana().getAccountInfo(address);
  if (!a || !a.owner.equals(KLEND) || a.data.length < 8000) throw new ExecError("This Kamino reserve isn't available right now.");
  const d = a.data;
  const avail = readU64(d, 224);
  const totalSf = avail * SF + readU128(d, 232) - readU128(d, 344) - readU128(d, 360) - readU128(d, 376);
  // Unset oracles are all-zero or klend's "nu11…1" sentinel; Anchor's "None" is passed as the program id.
  const opt = (o: number) => (isNullKey(readKey(d, o)) || readKey(d, o).equals(KLEND_NULL) ? KLEND : readKey(d, o));
  return {
    address,
    market: readKey(d, 32),
    liqMint: readKey(d, 128),
    liqSupply: readKey(d, 160),
    liqProgram: readKey(d, 408),
    decimals: Number(readU64(d, 272)),
    collMint: readKey(d, 2560),
    collSupply: readU64(d, 2592),
    totalSf,
    oracles: [opt(5224), opt(5160), opt(5192), opt(5112)],
    depositLimit: readU64(d, 5016),
    available: avail,
    status: d[4856],
  };
}

const lma = (market: PublicKey) => PublicKey.findProgramAddressSync([seed("lma"), market.toBuffer()], KLEND)[0];

const refreshReserveIx = (r: Reserve) =>
  ix(
    KLEND,
    [
      [r.address, true, false],
      [r.market, false, false],
      ...r.oracles.map((o): [PublicKey, boolean, boolean] => [o, false, false]),
    ],
    hexBytes("02da8aeb4fc91966"),
  );

/** kTokens → asset units, at the reserve's last-updated exchange rate. */
const kToAsset = (r: Reserve, k: bigint) => (r.collSupply > ZERO ? (k * r.totalSf) / (r.collSupply * SF) : ZERO);
/** Asset units → kTokens, rounded up. */
const assetToK = (r: Reserve, amt: bigint) => (r.totalSf > ZERO ? (amt * r.collSupply * SF + r.totalSf - BigInt(1)) / r.totalSf : ZERO);


/** Unsigned klend supply transaction: `amount` of the reserve's asset (native SOL for SOL reserves) into kTokens. */
async function klendDepositTx(sol: string, address: PublicKey, amount: bigint): Promise<string> {
  const r = await readReserve(address);
  const isSol = r.liqMint.toBase58() === WSOL;
  const src = ata(sol, r.liqMint, r.liqProgram);
  const dst = ata(sol, r.collMint, TOKEN_PROGRAM);
  return buildTx(sol, [
    computeLimitIx(400_000),
    createAtaIx(sol, r.collMint, TOKEN_PROGRAM),
    ...(isSol ? wrapSolIxs(sol, amount) : []),
    refreshReserveIx(r),
    ix(
      KLEND,
      [
        [pk(sol), false, true],
        [r.address, true, false],
        [r.market, false, false],
        [lma(r.market), false, false],
        [r.liqMint, false, false],
        [r.liqSupply, true, false],
        [r.collMint, true, false],
        [src, true, false],
        [dst, true, false],
        [TOKEN_PROGRAM, false, false],
        [r.liqProgram, false, false],
        [SYSVAR_INSTRUCTIONS, false, false],
      ],
      bytes(hexBytes("a9c91e7e06cd6644"), u64le(amount)),
    ),
    ...(isSol ? [unwrapSolIx(sol)] : []),
  ]);
}

/** Unsigned klend redeem transaction: `k` kTokens back into the asset (native SOL for SOL reserves). */
async function klendWithdrawTx(sol: string, address: PublicKey, k: bigint, all: boolean): Promise<string> {
  const r = await readReserve(address);
  const isSol = r.liqMint.toBase58() === WSOL;
  const dst = ata(sol, r.liqMint, r.liqProgram);
  const src = ata(sol, r.collMint, TOKEN_PROGRAM);
  return buildTx(sol, [
    computeLimitIx(400_000),
    createAtaIx(sol, r.liqMint, r.liqProgram),
    refreshReserveIx(r),
    ix(
      KLEND,
      [
        [pk(sol), false, true],
        [r.market, false, false],
        [r.address, true, false],
        [lma(r.market), false, false],
        [r.liqMint, false, false],
        [r.collMint, true, false],
        [r.liqSupply, true, false],
        [src, true, false],
        [dst, true, false],
        [TOKEN_PROGRAM, false, false],
        [r.liqProgram, false, false],
        [SYSVAR_INSTRUCTIONS, false, false],
      ],
      bytes(hexBytes("ea75b57db98edc1d"), u64le(k)),
    ),
    ...(all ? [closeAccountIx(src, sol)] : []), // reclaim the kToken account's rent
    ...(isSol ? [unwrapSolIx(sol)] : []),
  ]);
}

/** Throws before any money moves if the reserve isn't taking deposits (closed, or its deposit cap is zero). */
const open = (r: Reserve, adding = ZERO) => {
  if (r.status !== 0 || r.depositLimit === ZERO) throw new ExecError("This Kamino reserve isn't taking deposits right now.");
  if (r.totalSf / SF + adding >= r.depositLimit) throw new ExecError("This Kamino reserve is full (it reached its deposit cap).");
  return r;
};

function klendReserve(reserve: string, symbol: string): Adapter {
  const address = new PublicKey(reserve);
  const info = () => timeout(readReserve(address), 30_000, "Kamino");
  return {
    positionSymbol: symbol,
    depositSteps: IN_STEPS,
    withdrawSteps: OUT_STEPS,

    position: async (s) => {
      if (!s.solanaAddress) return 0;
      const r = await info();
      const k = await splBalance(s.solanaAddress, r.collMint.toBase58());
      return Number(formatUnits(kToAsset(r, k), r.decimals));
    },
    previewDeposit: async (s, usdg) => previewToSolana(s, usdg, open(await info()).liqMint.toBase58(), symbol),
    previewWithdraw: async (s, amount) => {
      const r = await info();
      return previewFromSolana(s, r.liqMint.toBase58(), parseUnits(amount, r.decimals));
    },

    deposit: async (s, usdg, on) => {
      const sol = needSol(s);
      const r0 = open(await info());
      const mint = r0.liqMint.toBase58();
      const isSol = mint === WSOL;
      const got = await toSolana(s, usdg, mint, symbol, on);
      on("deposit", "running");
      const read = () => splBalance(sol, r0.collMint.toBase58());
      const before = await read();
      let amount = got;
      try {
        open(await readReserve(address), got);
      } catch (e) {
        throw new ExecError(`${(e as Error).message} Your ${symbol} is in your Solana wallet.`);
      }
      await sendSol(s, async () => {
        if (isSol) amount = await spendableSol(sol, got);
        return klendDepositTx(sol, address, amount);
      });
      await waitForArrival(read, before, 60_000);
      on("deposit", "done");
      return `${formatUnits(amount, r0.decimals)} ${symbol}`;
    },

    withdraw: async (s, amount, on) => {
      const sol = needSol(s);
      const r0 = await info();
      const mint = r0.liqMint.toBase58();
      const isSol = mint === WSOL;
      on("withdraw", "running");
      const held = await splBalance(sol, r0.collMint.toBase58());
      if (held === ZERO) throw new ExecError("You don't have a position in this vault.");
      const want = amount === "max" ? held : assetToK(r0, parseUnits(amount, r0.decimals));
      const k = want < held ? want : held;
      const all = k === held;
      const read = () => solBalance(sol, mint);
      const before = await read();
      await sendSol(s, () => klendWithdrawTx(sol, address, k, all));
      const out = await waitForArrival(read, before, 60_000);
      on("withdraw", "done", `${formatUnits(out, r0.decimals)} ${symbol}`);
      return fromSolana(s, mint, out, on);
    },
  };
}

/* ---------------- kvaults (Kamino Earn) ---------------- */

type KVaultState = {
  baseVaultAuthority: string;
  tokenMint: string;
  tokenMintDecimals: number;
  tokenVault: string;
  tokenProgram: string;
  sharesMint: string;
  sharesMintDecimals: number;
  vaultAllocationStrategy: (string | { reserve: string; ctokenVault?: string; ctokenAllocation?: string })[];
  vaultLookupTable?: string;
  vaultFarm?: string;
  minDepositAmount?: string;
  name?: string;
};
type KVault = { address: string; state: KVaultState };

let kvaultList: { at: number; p: Promise<KVault[]> } | null = null;
async function kvaultState(address: string): Promise<KVaultState> {
  if (!kvaultList || Date.now() - kvaultList.at > 5 * 60_000) {
    const p = fetch(`${KAMINO_API}/kvaults/vaults`).then((r) => {
      if (!r.ok) throw new ExecError(`Kamino didn't answer (${r.status}).`);
      return r.json() as Promise<KVault[]>;
    });
    p.catch(() => (kvaultList = null));
    kvaultList = { at: Date.now(), p };
  }
  const v = (await kvaultList.p).find((x) => x.address === address);
  if (!v) throw new ExecError("This Kamino vault isn't available right now.");
  return v.state;
}

const reserveKey = (x: string | { reserve: string }) => (typeof x === "string" ? x : x.reserve);
const NULL = PublicKey.default.toBase58();

/** The vault's reserves (writable) followed by their lending markets, as kvault instructions expect. */
async function vaultRemaining(st: KVaultState): Promise<[PublicKey, boolean, boolean][]> {
  const reserves = st.vaultAllocationStrategy.map(reserveKey).filter((r) => r && r !== NULL).map((r) => new PublicKey(r));
  // Free RPCs allow at most 10 accounts per request.
  const chunks = Array.from({ length: Math.ceil(reserves.length / 10) }, (_, i) => reserves.slice(i * 10, i * 10 + 10));
  const accs = (await Promise.all(chunks.map((c) => solana().getMultipleAccountsInfo(c)))).flat();
  const markets = accs.map((a) => {
    if (!a) throw new ExecError("Couldn't read the vault's reserves.");
    return readKey(a.data, 32);
  });
  return [...reserves.map((r): [PublicKey, boolean, boolean] => [r, true, false]), ...markets.map((m): [PublicKey, boolean, boolean] => [m, false, false])];
}

type Farm = { address: PublicKey; vault: PublicKey; authority: PublicKey; scope: PublicKey; delayed: boolean };
async function readFarm(address: string | undefined): Promise<Farm | null> {
  if (!address || address === NULL) return null;
  const a = await solana().getAccountInfo(new PublicKey(address));
  if (!a || !a.owner.equals(FARMS) || a.data.length < 7700) return null;
  const d = a.data;
  const scope = readKey(d, 7536);
  // A warm-up or cool-down would delay withdrawals, so such farms are skipped (shares stay in the wallet).
  const delayed = new DataView(d.buffer, d.byteOffset).getUint32(7400, true) > 0 || new DataView(d.buffer, d.byteOffset).getUint32(7404, true) > 0;
  return { address: new PublicKey(address), vault: readKey(d, 7256), authority: readKey(d, 7288), scope: isNullKey(scope) ? FARMS : scope, delayed };
}
const farmUser = (farm: PublicKey, owner: string) => PublicKey.findProgramAddressSync([seed("user"), farm.toBuffer(), pk(owner).toBuffer()], FARMS)[0];

/** Shares staked in the farm for `owner`. */
async function stakedShares(farm: Farm | null, owner: string): Promise<bigint> {
  if (!farm) return ZERO;
  const a = await solana().getAccountInfo(farmUser(farm.address, owner));
  if (!a || a.data.length < 424) return ZERO;
  return readU128(a.data, 408) / FARM_SCALE; // active_stake_scaled
}

async function tokensPerShare(vault: string): Promise<number> {
  const m = (await fetch(`${KAMINO_API}/kvaults/${vault}/metrics`).then((r) => r.json())) as { tokensPerShare?: string };
  const t = Number(m.tokensPerShare);
  if (!(t > 0)) throw new ExecError("Kamino didn't report the vault's share price.");
  return t;
}

const EVENT_AUTHORITY = PublicKey.findProgramAddressSync([seed("__event_authority")], KVAULT)[0];
const GLOBAL_CONFIG = PublicKey.findProgramAddressSync([seed("global_config")], KVAULT)[0];

/** Unsigned kvault deposit (plus staking the shares in the vault's farm, when it has one). */
async function kvaultDepositTx(sol: string, vault: string, v: KVaultState, farm: Farm | null, amount: bigint): Promise<string> {
  const vaultKey = new PublicKey(vault);
  const isSol = v.tokenMint === WSOL;
  const tokenProgram = new PublicKey(v.tokenProgram);
  const sharesAta = ata(sol, v.sharesMint, TOKEN_PROGRAM);
  const ixs = [
    computeLimitIx(800_000),
    createAtaIx(sol, v.sharesMint, TOKEN_PROGRAM),
    ...(isSol ? wrapSolIxs(sol, amount) : []),
    ix(
      KVAULT,
      [
        [pk(sol), true, true],
        [vaultKey, true, false],
        [pk(v.tokenVault), true, false],
        [pk(v.tokenMint), false, false],
        [pk(v.baseVaultAuthority), false, false],
        [pk(v.sharesMint), true, false],
        [ata(sol, v.tokenMint, tokenProgram), true, false],
        [sharesAta, true, false],
        [KLEND, false, false],
        [tokenProgram, false, false],
        [TOKEN_PROGRAM, false, false],
        [EVENT_AUTHORITY, false, false],
        [KVAULT, false, false],
        ...(await vaultRemaining(v)),
      ],
      bytes(hexBytes("f223c68952e1f2b6"), u64le(amount)),
    ),
  ];
  if (farm) {
    const user = farmUser(farm.address, sol);
    if (!(await solana().getAccountInfo(user)))
      ixs.push(
        ix(
          FARMS,
          [
            [pk(sol), false, true],
            [pk(sol), true, true],
            [pk(sol), false, false],
            [pk(sol), false, false],
            [user, true, false],
            [farm.address, true, false],
            [SystemProgram.programId, false, false],
            [SYSVAR_RENT, false, false],
          ],
          hexBytes("6f11b9fa3c7a26fe"),
        ),
      );
    ixs.push(
      ix(
        FARMS,
        [
          [pk(sol), false, true],
          [user, true, false],
          [farm.address, true, false],
          [farm.vault, true, false],
          [sharesAta, true, false],
          [pk(v.sharesMint), false, false],
          [farm.scope, false, false],
          [TOKEN_PROGRAM, false, false],
        ],
        bytes(hexBytes("ceb0ca12c8d1b36c"), u64le(U64_MAX)), // stake everything in the shares account
      ),
    );
  }
  if (isSol) ixs.push(unwrapSolIx(sol));
  return buildTx(sol, ixs, v.vaultLookupTable && v.vaultLookupTable !== NULL ? [v.vaultLookupTable] : []);
}

/** The reserve a withdrawal pulls from: the one where the vault can take out the most right now. */
async function withdrawSource(v: KVaultState): Promise<{ r: Reserve; ctokenVault: PublicKey } | null> {
  const allocs = v.vaultAllocationStrategy.flatMap((a) =>
    typeof a !== "string" && a.reserve !== NULL && a.ctokenVault && BigInt(a.ctokenAllocation ?? "0") > ZERO ? [{ ...a, ctokenVault: a.ctokenVault, k: BigInt(a.ctokenAllocation ?? "0") }] : [],
  );
  const read = await Promise.allSettled(allocs.map((a) => readReserve(new PublicKey(a.reserve))));
  let best: { r: Reserve; ctokenVault: PublicKey; room: bigint } | null = null;
  read.forEach((x, i) => {
    if (x.status !== "fulfilled") return;
    const held = kToAsset(x.value, allocs[i].k);
    const room = held < x.value.available ? held : x.value.available;
    if (!best || room > best.room) best = { r: x.value, ctokenVault: new PublicKey(allocs[i].ctokenVault), room };
  });
  return best;
}

/** Unsigned kvault withdrawal: unstakes `fromFarm` shares from the farm if needed, then burns `burn` shares. */
async function kvaultWithdrawTx(sol: string, vault: string, v: KVaultState, farm: Farm | null, burn: bigint, fromFarm: bigint, all: boolean): Promise<string> {
  const vaultKey = new PublicKey(vault);
  const isSol = v.tokenMint === WSOL;
  const src = await withdrawSource(v);
  const tokenProgram = new PublicKey(v.tokenProgram);
  const sharesAta = ata(sol, v.sharesMint, TOKEN_PROGRAM);
  const ixs = [computeLimitIx(1_000_000), createAtaIx(sol, v.sharesMint, TOKEN_PROGRAM), createAtaIx(sol, v.tokenMint, tokenProgram)];
  if (farm && fromFarm > ZERO) {
    const user = farmUser(farm.address, sol);
    ixs.push(
      ix(FARMS, [[pk(sol), true, true], [user, true, false], [farm.address, true, false], [farm.scope, false, false]], bytes(hexBytes("5a5f6b2acd7c32e1"), u128le((all ? U64_MAX : fromFarm) * FARM_SCALE))),
      ix(
        FARMS,
        [
          [pk(sol), true, true],
          [user, true, false],
          [farm.address, true, false],
          [sharesAta, true, false],
          [farm.vault, true, false],
          [farm.authority, false, false],
          [TOKEN_PROGRAM, false, false],
        ],
        hexBytes("2466bb31dc248443"),
      ),
    );
  }
  ixs.push(
    ix(
      KVAULT,
      [
        [pk(sol), true, true],
        [vaultKey, true, false],
        [GLOBAL_CONFIG, false, false],
        [pk(v.tokenVault), true, false],
        [pk(v.baseVaultAuthority), false, false],
        [ata(sol, v.tokenMint, tokenProgram), true, false],
        [pk(v.tokenMint), true, false],
        [sharesAta, true, false],
        [pk(v.sharesMint), true, false],
        [tokenProgram, false, false],
        [TOKEN_PROGRAM, false, false],
        [KLEND, false, false],
        [EVENT_AUTHORITY, false, false],
        [KVAULT, false, false],
        ...(src
          ? ([
              [vaultKey, true, false],
              [src.r.address, true, false],
              [src.ctokenVault, true, false],
              [src.r.market, false, false],
              [lma(src.r.market), false, false],
              [src.r.liqSupply, true, false],
              [src.r.collMint, true, false],
              [TOKEN_PROGRAM, false, false],
              [SYSVAR_INSTRUCTIONS, false, false],
              [EVENT_AUTHORITY, false, false],
              [KVAULT, false, false],
            ] as [PublicKey, boolean, boolean][])
          : []),
        ...(await vaultRemaining(v)),
      ],
      // `withdraw` takes the vault's idle funds first, then pulls the rest out of one reserve.
      bytes(hexBytes(src ? "b712469c946da122" : "1383709baadc2239"), u64le(all ? U64_MAX : burn)),
    ),
  );
  if (all) ixs.push(closeAccountIx(sharesAta, sol));
  if (isSol) ixs.push(unwrapSolIx(sol));
  return buildTx(sol, ixs, v.vaultLookupTable && v.vaultLookupTable !== NULL ? [v.vaultLookupTable] : []);
}

function kvault(vault: string, symbol: string): Adapter {
  const st = () => timeout(kvaultState(vault), 30_000, "Kamino");
  const shares = async (owner: string, s: KVaultState, farm: Farm | null) => {
    const [w, f] = await Promise.all([splBalance(owner, s.sharesMint), stakedShares(farm, owner)]);
    return { wallet: w, farm: f, total: w + f };
  };
  const useFarm = async (s: KVaultState) => {
    const f = await readFarm(s.vaultFarm);
    return f && !f.delayed ? f : null;
  };
  return {
    positionSymbol: symbol,
    depositSteps: IN_STEPS,
    withdrawSteps: OUT_STEPS,

    position: async (s) => {
      if (!s.solanaAddress) return 0;
      const v = await st();
      const farm = await timeout(readFarm(v.vaultFarm));
      const sh = await timeout(shares(s.solanaAddress, v, farm));
      if (sh.total === ZERO) return 0;
      return (Number(formatUnits(sh.total, v.sharesMintDecimals)) * (await timeout(tokensPerShare(vault)))) || 0;
    },
    previewDeposit: async (s, usdg) => previewToSolana(s, usdg, (await st()).tokenMint, symbol),
    previewWithdraw: async (s, amount) => {
      const v = await st();
      return previewFromSolana(s, v.tokenMint, parseUnits(amount, v.tokenMintDecimals));
    },

    deposit: async (s, usdg, on) => {
      const sol = needSol(s);
      const v = await st();
      const isSol = v.tokenMint === WSOL;
      const got = await toSolana(s, usdg, v.tokenMint, symbol, on);
      on("deposit", "running");
      if (v.minDepositAmount && got < BigInt(v.minDepositAmount)) throw new ExecError(`The vault's minimum deposit is ${formatUnits(BigInt(v.minDepositAmount), v.tokenMintDecimals)} ${symbol}. Your ${symbol} is in your Solana wallet.`);
      const farm = await useFarm(v);
      const before = await shares(sol, v, farm);
      let amount = got;
      await sendSol(s, async () => {
        if (isSol) amount = await spendableSol(sol, got);
        return kvaultDepositTx(sol, vault, v, farm, amount);
      });
      await waitForArrival(async () => (await shares(sol, v, farm)).total, before.total, 60_000);
      on("deposit", "done");
      return `${formatUnits(amount, v.tokenMintDecimals)} ${symbol}`;
    },

    withdraw: async (s, amount, on) => {
      const sol = needSol(s);
      const v = await st();
      const isSol = v.tokenMint === WSOL;
      on("withdraw", "running");
      // Shares may sit in the farm even if it was later given a cool-down, so unstaking uses the farm as it is.
      const farm = await readFarm(v.vaultFarm);
      const sh = await shares(sol, v, farm);
      if (sh.total === ZERO) throw new ExecError("You don't have a position in this vault.");
      let burn = sh.total;
      if (amount !== "max") {
        const want = BigInt(Math.ceil(Number(parseUnits(amount, v.tokenMintDecimals)) / (await tokensPerShare(vault))));
        if (want < burn) burn = want;
      }
      const all = burn === sh.total;
      const fromFarm = burn > sh.wallet ? burn - sh.wallet : ZERO;
      if (fromFarm > ZERO && farm?.delayed) throw new ExecError("This vault's rewards farm has a cool-down; unstake on Kamino first, then withdraw here.");
      const read = () => solBalance(sol, v.tokenMint);
      const before = await read();
      await sendSol(s, () => kvaultWithdrawTx(sol, vault, v, farm, burn, fromFarm, all));
      const out = await waitForArrival(read, before, 60_000);
      on("withdraw", "done", `${formatUnits(out, v.tokenMintDecimals)} ${symbol}`);
      return fromSolana(s, v.tokenMint, out, on);
    },
  };
}

/* ---------------- registration ---------------- */

const isKey = (k: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(k);

registerAdapters((o: Opp) => {
  if (o.chain !== "Solana" || o.protocol !== "Kamino" || !o.id.startsWith("kamino:solana:")) return null;
  const rest = o.id.slice("kamino:solana:".length);
  const symbol = o.asset === "Token" ? o.ticker ?? "tokens" : o.asset;
  if (rest.startsWith("kv:")) return isKey(rest.slice(3)) ? kvault(rest.slice(3), symbol) : null;
  return isKey(rest) ? klendReserve(rest, symbol) : null;
});

/** Builders, exported for scripts and tests. */
export const kaminoInternals = { readReserve, kvaultState, readFarm, stakedShares, tokensPerShare, kToAsset, assetToK, klendDepositTx, klendWithdrawTx, kvaultDepositTx, kvaultWithdrawTx };
