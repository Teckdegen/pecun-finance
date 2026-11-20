/**
 * Payback: how long a move takes to earn back what it costs.
 *
 * New money: the deposit's cost (Pecun's fee + bridge/swap fees + price impact) against the vault's APY.
 * Switching from a vault you hold: the cost of leaving it plus the cost of entering the new one, against the extra
 * APY the new vault pays. Days the money sits in an exit queue earn nothing, so they're added on, along with the
 * yield the old vault would have paid over them.
 */

export type Payback =
  | { kind: "new"; costUsd: number; costPct: number; apy: number; days: number | null }
  | { kind: "switch"; costUsd: number; costPct: number; gain: number; lockDays: number; days: number | null };

/** The APY to judge a move on: the 30-day average when there is one, so a one-day spike doesn't decide it. */
export const steadyApy = (o: { apy: number | null; apy7d?: number | null; apy30d?: number | null }) => o.apy30d ?? o.apy7d ?? o.apy ?? 0;

/** Days a vault takes to pay out after you ask, read from its redemption terms ("Instant", "24 hours", "up to 7 days"…). */
export function lockupDays(redemption?: string | null): number {
  if (!redemption || /^instant\b(?!, \d)/i.test(redemption.trim())) return 0;
  const r = redemption.toLowerCase();
  const n = (re: RegExp) => {
    const m = r.match(re);
    return m ? Number(m[1]) : null;
  };
  const weeks = n(/(\d+(?:\.\d+)?)\s*weeks?/) ?? (/\ba week\b/.test(r) ? 1 : null);
  if (weeks !== null) return weeks * 7;
  const days = n(/(\d+(?:\.\d+)?)\s*days?/);
  if (days !== null) return days;
  const hours = n(/(\d+(?:\.\d+)?)\s*(?:hours?|h)\b/);
  if (hours !== null) return hours / 24;
  return 0;
}

/** Deposit of `amountUsd` with `entryPct` total cost (fee + route), into a vault paying `apy`. */
export function newMoney(amountUsd: number, entryPct: number, apy: number): Payback {
  const costUsd = (amountUsd * entryPct) / 100;
  const perDay = (amountUsd * apy) / 365;
  return { kind: "new", costUsd, costPct: entryPct, apy, days: perDay > 0 ? costUsd / perDay : null };
}

/** Moving `amountUsd` from a vault paying `apyFrom` (exit `exitPct`, `lockDays` to pay out) into one paying `apyTo`. */
export function switchMove(amountUsd: number, exitPct: number, entryPct: number, apyFrom: number, apyTo: number, lockDays: number): Payback {
  const costPct = exitPct + entryPct;
  const missed = (amountUsd * apyFrom * lockDays) / 365; // what staying would have earned while the exit pays out
  const costUsd = (amountUsd * costPct) / 100 + missed;
  const gain = apyTo - apyFrom;
  const perDay = (amountUsd * gain) / 365;
  return { kind: "switch", costUsd, costPct, gain, lockDays, days: perDay > 0 ? lockDays + costUsd / perDay : null };
}

export function daysText(d: number): string {
  if (d < 1) return "under a day";
  if (d < 60) return `${Math.ceil(d)} day${Math.ceil(d) === 1 ? "" : "s"}`;
  if (d < 730) return `${Math.round(d / 30.4)} months`;
  return `${(d / 365).toFixed(1)} years`;
}
