import { Plus } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GetStarted } from "@/components/get-started";
import { LiveVault } from "@/components/live-vault";
import { Logo, PecunMark } from "@/components/logo";
import { Socials } from "@/components/socials";
import { getLive, usd, type ChainMark, type Featured } from "@/lib/live";
import { pageMeta } from "@/lib/meta";
import { DOCS_URL, INTEGRATIONS, PARTNERS, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, TURNKEY } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: `${SITE_NAME} · ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  path: "/",
  absolute: true,
});

// Live figures from the app, refreshed every 5 minutes.
export const revalidate = 300;

export default async function Home() {
  const live = await getLive();
  const shown = new Set(PARTNERS.filter((p) => !p.infra).slice(0, 8).map((p) => p.name));
  const spots = (live.rows.length ? live.rows : live.featured).filter((v) => !shown.has(v.protocol));
  // The explore list always shows four platforms: top up from the rest when the filter leaves fewer.
  const pool = [...live.rows, ...live.featured];
  const explore = [...spots, ...pool.filter((v) => !spots.includes(v) && v.protocol !== live.example.protocol)]
    .filter((v, i, all) => all.findIndex((x) => x.protocol === v.protocol) === i)
    .slice(0, 4);
  const toRow = (v: Featured) => ({
    name: v.name,
    protocol: v.protocol,
    asset: v.asset,
    apy: v.apy,
    redemption: v.redemption,
    logo: v.protocolLogo,
    assetLogo: v.logo,
  });
  return (
    <div id="top">
      <Hero vaults={live.vaults} platforms={live.platforms} />
      <div className="bg-white text-ink">
        <Bento vaults={live.vaults} tvlUsd={live.tvlUsd} platforms={live.platforms} worthMarks={live.worthMarks} spots={spots} />
        <GetStarted rows={explore.map(toRow)} lead={toRow(live.example)}>
          <Faq />
        </GetStarted>
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */


/* ---------- hero (light) ---------- */

function Hero({ vaults, platforms }: { vaults: number; platforms: number }) {
  return (
    <section className="dots flex min-h-[calc(100dvh-3.5rem)] flex-col px-4 py-8 text-center sm:min-h-[calc(100dvh-4rem)]">
      <div className="rise my-auto">
        <h1 className="mx-auto max-w-3xl text-[2.7rem] font-medium leading-[1.02] tracking-[-0.045em] md:text-[5rem]">
          Put your money
          <br />
          <span className="inline-block whitespace-nowrap rounded-xl bg-lime px-2 md:px-3">to work</span>
        </h1>
        {/* Logos in a row, with the live count underneath. The named partner row below stays as it is. */}
        <div className="mt-8 flex flex-col items-center">
          <span className="flex items-center justify-center">
            {PARTNERS.filter((p) => !p.infra).slice(0, 8).map((p, i) => (
              <span key={p.name} title={p.name} className={`rounded-full bg-white ring-[3px] ring-paper ${i ? "-ml-2.5" : ""}`}>
                <Logo src={p.logo} label={p.name} size={34} />
              </span>
            ))}
          </span>
          <p className="mt-3 text-[15px] leading-none text-[#6b6b66]">
            <span className="tabular">{vaults.toLocaleString("en-US")}</span> vaults and yields from {platforms} platforms
          </p>
        </div>
        <ul aria-label="Integrations on Pecun" className="mx-auto mt-12 flex max-w-4xl flex-wrap items-center justify-center gap-x-7 gap-y-4">
          {[...PARTNERS.filter((p) => p.infra), ...INTEGRATIONS].map((p) => (
            <li key={p.name} className="flex items-center gap-2 opacity-55 grayscale transition hover:opacity-100 hover:grayscale-0">
              <Logo src={p.logo} label={p.name} size={22} />
              <span className="text-base font-semibold tracking-[-0.02em] text-[#3a3a36]">{p.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Bento({
  vaults,
  tvlUsd,
  platforms,
  worthMarks,
  spots,
}: {
  vaults: number;
  tvlUsd: number;
  platforms: number;
  worthMarks: ChainMark[];
  spots: Featured[];
}) {
  return (
    <section className="bg-[#f3efe6]">
      <div className="grid gap-2 md:grid-cols-3">
        <article className="flex min-h-[280px] flex-col bg-[#c6efb0] p-6 text-ink sm:p-8 md:min-h-[380px] md:rounded-br-3xl">
          <p className="text-sm text-ink/60">
            The list <span className="ml-3 tabular">01</span>
          </p>
          <h2 className="mt-auto max-w-[11ch] pt-16 text-[2.4rem] font-medium leading-[1.02] tracking-[-0.045em] sm:text-[3rem]">
            Find the rate. Deposit in one tap.
          </h2>
        </article>

        <article className="flex min-h-[280px] flex-col justify-center bg-[#f7f4ec] p-6 text-ink sm:p-8 md:min-h-[380px] md:rounded-b-3xl">
          <p className="max-w-[22ch] text-[1.35rem] font-medium leading-[1.3] tracking-[-0.03em] sm:text-[1.55rem]">
            Lending, vaults and staking in one list. The rate next to each one is live.
          </p>
          <p className="mt-6 max-w-[36ch] text-sm leading-relaxed text-[#5e5e58]">
            The deposit leaves your wallet and goes into the protocol you pick. Pecun never holds the keys, and never holds the deposit.
          </p>
        </article>

        <article className="flex min-h-[240px] flex-col justify-end bg-[#122018] p-6 text-white sm:p-8 md:min-h-[380px] md:rounded-bl-3xl">
          <p className="tabular text-[4.5rem] font-medium leading-none tracking-[-0.05em] sm:text-[5.5rem]">{usd(tvlUsd)}</p>
          <span className="mt-5 flex items-center">
            {worthMarks.map((c, i) => (
              <span key={c.name} title={c.name} className={`rounded-full bg-white ring-2 ring-[#122018] ${i ? "-ml-2.5" : ""}`}>
                <Logo src={c.logo} label={c.name} size={28} />
              </span>
            ))}
          </span>
          <p className="mt-8 max-w-[16ch] text-lg leading-snug text-white/75">Worth of opportunities</p>
        </article>

        <article className="flex min-h-[260px] flex-col justify-end bg-[#1c3a28] p-6 text-[#f4f1e8] sm:p-8 md:min-h-[340px] md:rounded-tr-3xl">
          <p className="max-w-[12ch] text-[1.7rem] font-medium leading-[1.15] tracking-[-0.03em] sm:text-[2rem]">Your keys stay yours.</p>
          <p className="mt-5 flex items-center gap-2.5 text-sm text-[#f4f1e8]/80">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white">
              <Logo src={TURNKEY.logo} label={TURNKEY.name} size={22} />
            </span>
            Powered by {TURNKEY.name}
          </p>
        </article>

        <article className="flex min-h-[260px] flex-col bg-[#e7f6dc] p-6 text-ink sm:p-8 md:min-h-[340px] md:rounded-t-3xl">
          <LiveVault vaults={spots} />
        </article>

        <article className="flex min-h-[260px] flex-col justify-end bg-[#fbfaf6] p-6 text-ink sm:p-8 md:min-h-[340px] md:rounded-tl-3xl">
          <p className="tabular text-[4rem] font-medium leading-none tracking-[-0.05em] sm:text-[4.75rem]">{vaults.toLocaleString("en-US")}</p>
          <p className="mt-8 max-w-[18ch] text-lg leading-snug">Yields from {platforms.toLocaleString("en-US")} platforms.</p>
        </article>
      </div>
    </section>
  );
}

function Faq() {
  const docs = (path: string, label: string) => (
    <a href={`${DOCS_URL}${path}`} className="font-medium text-ink underline decoration-black/25 underline-offset-[3px] hover:decoration-black">
      {label}
    </a>
  );
  const qa: [string, ReactNode][] = [
    [
      "What is Pecun?",
      "One place for on-chain yield. Pecun brings together lending markets, vaults, liquid staking and fixed yield from the biggest protocols and platforms, with the live rate next to each one, so you can compare them and put your money where it earns the most.",
    ],
    [
      "What is $PEN?",
      <>
        Pecun&apos;s token. Every $PEN trade pays a 3% tax: 70% goes into the Pecun Fund, which holders own a share of, and 30% pays for running
        Pecun. The supply is 1,000,000,000, and it&apos;s a fair launch with no presale. {docs("/token", "Read about $PEN")}.
      </>,
    ],
    [
      "What is the Pecun Fund?",
      <>
        The pool 70% of the $PEN tax pays into. It&apos;s put to work across delta-neutral strategies, yield vaults, lending, liquid staking and $PEN
        buybacks, and as it grows it can add tokenized stocks and bonds. Its wallet and positions are public, and its value can go down
        as well as up. {docs("/fund", "See how the Fund works")}.
      </>,
    ],
    [
      "How do I get my share of the Fund?",
      <>
        Hold $PEN. Your share is your tokens divided by the $PEN in circulation, and it&apos;s paid to you automatically when you sell.{" "}
        {docs("/fund", "Work out your share")}.
      </>,
    ],
    [
      "Who holds my money?",
      "You do. Your Pecun wallet is self-custodial and runs on Turnkey, so only you can approve a transaction. Deposits go from your wallet straight into the protocol you pick. Pecun never holds your funds and can't move them.",
    ],
    [
      "Where do the rates come from?",
      "From each protocol, live. You can compare vaults by their 7-day or 30-day APY, and where a vault charges a performance fee you see the APY after that fee. Rates move all the time, so treat them as today's figure, not a promise.",
    ],
    [
      "Which vaults does Pecun list?",
      "Only ones Pecun can actually deposit into for you. If a protocol closes a vault, it's marked as closed and you can still withdraw from it, but no new deposits go in.",
    ],
    [
      "Can I withdraw whenever I want?",
      "That depends on the vault. Some pay out instantly, some go through the protocol's withdrawal queue, and fixed-yield positions pay out at maturity. Each vault shows how withdrawals work before you deposit.",
    ],
    [
      "What does it cost?",
      "Pecun charges a small fee on deposits and withdrawals, always shown before you confirm. Network fees are currently paid by Pecun. Protocols may charge their own fees on top, which are shown on the vault.",
    ],
    [
      "Is it risky?",
      "Yes. All yield carries risk, including smart-contract failures, depegs and market losses, and you could lose what you deposit. Read the Risk Disclosure in the app before you start.",
    ],
    [
      "Where is Pecun available?",
      "Most of the world, but not everywhere. Pecun isn't available in some regions, including the United States, the United Kingdom, Ontario and sanctioned countries. The full list is in the Terms of Service in the app.",
    ],
  ];
  return (
    <section className="relative z-[70] flex min-h-[100dvh] flex-col justify-center rounded-t-[2rem] bg-white px-4 pt-24 pb-16 text-ink shadow-[0_-12px_32px_rgba(10,10,10,0.08)] sm:px-8 md:pt-28 md:pb-24">
      <div className="mx-auto w-full max-w-4xl">
        <h2 className="text-center text-[2.6rem] font-medium leading-[1.04] tracking-[-0.045em] sm:text-[3.5rem] lg:text-[4.5rem]">
          Questions,
          <span className="block text-[#8a8a83]">answered.</span>
        </h2>
        <div className="mt-12 divide-y divide-line border-y border-line md:mt-16">
          {qa.map(([q, a]) => (
            <details key={q} className="group py-6 md:py-8">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[1.25rem] font-medium leading-snug tracking-[-0.02em] md:text-[1.6rem] [&::-webkit-details-marker]:hidden">
                {q}
                <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-[#5e5e58] transition group-open:rotate-45 group-open:border-ink group-open:bg-ink group-open:text-white md:size-12">
                  <Plus className="size-5" />
                </span>
              </summary>
              <p className="mt-4 max-w-3xl pr-12 font-sans text-base leading-relaxed text-[#5e5e58] md:mt-5 md:pr-16 md:text-lg">{a}</p>
            </details>
          ))}
        </div>

        {/* Footer: the brand, and where to find Pecun on X and Discord. */}
        <footer className="mt-16 flex flex-col items-center justify-between gap-5 sm:flex-row md:mt-20">
          <span className="flex items-center gap-2 text-sm text-[#5e5e58]">
            <PecunMark size={22} />
            &copy; {new Date().getFullYear()} Pecun
          </span>
          <Socials />
        </footer>
      </div>
    </section>
  );
}
