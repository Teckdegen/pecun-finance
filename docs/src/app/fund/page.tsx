import type { Metadata } from "next";
import { ChartCard, Donut, Flow, RangeBars, ShareCalculator, SplitBar, TaxCalculator, type Slice } from "@/components/charts";
import { A, Callout, Doc, Facts, H2, H3, List, P, Steps } from "@/components/chrome";

export const metadata: Metadata = {
  title: "Pecun Fund",
  description: "The Pecun Fund: where the $PEN tax goes, how it's invested across delta-neutral strategies and yield vaults, and how holders share in it.",
};

/** Target split of the Fund. The live split is published on this page once the Fund is running. */
const ALLOCATION: Slice[] = [
  { label: "Delta-neutral strategies", value: 30, color: "#0a0a0a", note: "Earn funding and basis while staying hedged against price moves." },
  { label: "Yield vaults", value: 25, color: "#2f7d1c", note: "Curated vaults that allocate across lending and liquidity markets." },
  { label: "$PEN buybacks", value: 15, color: "#1c3a28", note: "Buys $PEN on the market and takes it out of circulation." },
  { label: "Lending markets", value: 15, color: "#7ed957", note: "Supply stablecoins and blue-chip assets to borrowers." },
  { label: "Liquid staking", value: 10, color: "#b8ff9d", note: "Staking yield, held as liquid staking tokens." },
  { label: "Cash reserve", value: 5, color: "#d8d2c2", note: "Stablecoins kept ready to pay holders who sell." },
];

export default function Fund() {
  return (
    <Doc href="/fund">
      <P>
        The Pecun Fund is the shared pool behind $PEN. Every $PEN trade pays a 3% tax: 70% of it goes into the Fund and 30% pays for running Pecun.
        Pecun invests the Fund across the same protocols
        the app lists: hedged delta-neutral strategies, yield vaults, lending markets and liquid staking, and uses part of it to buy back $PEN. The Fund
        belongs to $PEN holders. Each holder
        owns a slice of it in proportion to their tokens, and gets that slice paid out when they sell.
      </P>
      <P>
        Think of it as a long-term savings pot for the whole community. New trading keeps adding to it, the yield it earns stays in it, and the longer
        it runs the more it has to work with.
      </P>

      <H2>The Fund at a glance</H2>
      <Facts
        rows={[
          ["Funded by", "70% of the 3% tax on every $PEN trade. The other 30% pays Pecun's running costs."],
          ["Owned by", "$PEN holders, in proportion to the tokens they hold."],
          ["Invested in", "Delta-neutral strategies, yield vaults, lending markets and liquid staking, on the protocols Pecun lists, plus $PEN buybacks."],
          ["Managed by", "Pecun, following the allocation and risk limits on this page."],
          ["Paid out", "Automatically, as your share of the Fund, when you sell $PEN."],
          ["Visible", "The Fund's wallet and positions are published here, so anyone can check them."],
        ]}
      />

      <H2>Where the money comes from</H2>
      <ChartCard title="How a trade feeds the Fund" caption="The tax is taken in the same transaction as the trade. No one has to claim or move it by hand.">
        <Flow
          steps={[
            { title: "A $PEN trade", body: "Someone buys or sells $PEN." },
            { title: "3% tax", body: "3% of the trade is set aside by the token contract.", tone: "lime" },
            { title: "Pecun Fund", body: "70% of the tax lands in the Fund's wallet. 30% covers running costs.", tone: "dark" },
            { title: "Put to work", body: "It's deployed across the strategies below." },
          ]}
        />
      </ChartCard>

      <ChartCard title="Where the tax goes" caption="Out of every $100 traded, $3 is tax: $2.10 goes into the Fund and $0.90 pays for running Pecun.">
        <SplitBar
          data={[
            { label: "Pecun Fund", value: 70, color: "#2f7d1c", note: "Invested for holders: $2.10 of every $100 traded." },
            { label: "Running costs", value: 30, color: "#0a0a0a", note: "The team, infrastructure, security audits and the network fees Pecun covers." },
          ]}
        />
      </ChartCard>

      <P>
        Running costs keep Pecun going: the people building it, servers and data, security audits, and the network fees Pecun pays on users&apos; behalf.
        They&apos;re reported alongside the Fund, so it&apos;s clear where every part of the tax goes.
      </P>

      <P>
        Because the tax is a share of every trade, the Fund grows fastest when $PEN trades the most. The calculator shows how much the Fund's 70% of the tax adds at
        different daily volumes, before the Fund earns any yield.
      </P>
      <ChartCard title="What the tax adds to the Fund" caption="The Fund's 70% of the tax only, at a steady daily volume. Real volume goes up and down, and these figures don't include yield or losses.">
        <TaxCalculator />
      </ChartCard>

      <H2>Where the money goes</H2>
      <P>
        The Fund spreads its money across six buckets, so no single strategy or protocol decides how it does. This is the target split. The live
        split will be shown here once the Fund is running, and it moves within limits as markets change.
      </P>
      <ChartCard title="Target allocation" caption="Target split of the Fund. Tap a slice to see it. The live allocation will be published on this page.">
        <Donut data={ALLOCATION} center="100%" sub="of the Fund, put to work" />
      </ChartCard>

      <H3>Delta-neutral strategies (30%)</H3>
      <P>
        A delta-neutral position holds an asset and an equal, opposite hedge at the same time, so moves in the asset&apos;s price cancel out. What&apos;s left
        is the yield: funding paid by traders on perpetuals markets, or the gap between spot and futures prices. The Fund uses these strategies because
        they can earn without betting on the market going up.
      </P>
      <List
        items={[
          "Earns from: funding rates, basis and the yield on the collateral itself.",
          "Main risks: funding can turn negative and cost money, the venues and protocols used can fail, and big price moves can strain the hedge.",
          "How the Fund handles them: hedges are kept close to neutral, positions are spread across venues, and strategies are cut back when funding turns negative.",
        ]}
      />

      <H3>Yield vaults (25%)</H3>
      <P>
        Vaults are managed strategies that move deposits across lending and liquidity markets to earn a blended rate. The Fund picks vaults with deep
        liquidity, a long track record and clear withdrawal terms, from the same list you can browse in the app.
      </P>
      <List
        items={[
          "Earns from: whatever the vault's strategy earns, after its own fees.",
          "Main risks: the vault's smart contracts, the markets it uses, and the manager's decisions.",
          "How the Fund handles them: no single vault gets too much, and vaults with slow or queued withdrawals are kept small.",
        ]}
      />

      <H3>Lending markets (15%)</H3>
      <P>
        Supplying stablecoins and blue-chip assets to lending markets earns the interest borrowers pay. It&apos;s one of the simplest and most liquid
        sources of yield, which makes it the Fund&apos;s steady base.
      </P>
      <List
        items={[
          "Earns from: interest paid by borrowers.",
          "Main risks: smart-contract failures, bad debt in the market and stablecoin depegs.",
          "How the Fund handles them: only large, long-running markets are used, spread across more than one protocol.",
        ]}
      />

      <H3>Liquid staking (10%)</H3>
      <P>
        Liquid staking earns staking rewards while holding a token that can still be sold or used. It adds a long-term, network-level yield to the Fund.
      </P>
      <List
        items={[
          "Earns from: staking rewards.",
          "Main risks: the staking token trading below its value, and the staking protocol's contracts.",
          "How the Fund handles them: only the most widely used staking tokens are held.",
        ]}
      />

      <H3>$PEN buybacks (15%)</H3>
      <P>
        15% of the Fund goes to buying $PEN on the open market. Bought-back tokens are burned, so they leave circulation for good. With fewer tokens in
        circulation, every token that&apos;s left owns a slightly bigger share of the Fund.
      </P>
      <List
        items={[
          "How it works: the Fund buys $PEN in small amounts over time rather than all at once, and burns what it buys.",
          "Why: it puts steady buying behind the token and raises every remaining holder's share of the Fund.",
          "Main risks: buybacks don't set the price. $PEN can still fall, and money spent on buybacks isn't earning yield.",
          "Every buyback and burn is published, with the date, the amount spent and the tokens burned.",
        ]}
      />

      <H3>Cash reserve (5%)</H3>
      <P>
        A slice of the Fund stays in stablecoins, ready to pay holders who sell straight away without having to unwind a strategy first. It also gives
        the Fund room to move into a better opportunity quickly.
      </P>

      <H2>What the Fund could earn</H2>
      <P>
        Each strategy earns at a different rate, and those rates move all the time. Based on the ranges these strategies have paid recently, the Fund
        as a whole could earn somewhere around 4% to 9% a year. The money that&apos;s actually invested, leaving out buybacks, could earn around 5% to
        10%.
      </P>
      <ChartCard
        title="Estimated yield by strategy"
        caption="Typical ranges these strategies have paid recently, not a forecast or a promise. Real yields change daily and can be lower, or negative."
      >
        <RangeBars
          max={20}
          rows={[
            { label: "Delta-neutral", weight: "30% of the Fund", low: 8, high: 15 },
            { label: "Yield vaults", weight: "25%", low: 5, high: 10 },
            { label: "Lending markets", weight: "15%", low: 3, high: 7 },
            { label: "Liquid staking", weight: "10%", low: 3, high: 4 },
            { label: "Cash reserve", weight: "5%", low: 0, high: 4 },
            { label: "$PEN buybacks", weight: "15%", low: 0, high: 0 },
            { label: "Whole Fund", weight: "Blended estimate", low: 4, high: 9, highlight: true },
          ]}
        />
      </ChartCard>
      <P>
        The blended figure is each strategy&apos;s range weighted by its share of the Fund. Buybacks don&apos;t earn yield, so they pull the blended number
        down, but they shrink the supply and raise every holder&apos;s share instead.
      </P>

      <H2>The strategy grows with the Fund</H2>
      <P>
        What the Fund invests in depends on how big it is. A small Fund stays in liquid on-chain yield it can move in and out of quickly. As it grows, it
        can take on investments that need more size and more patience, so the mix changes stage by stage.
      </P>
      <Steps
        items={[
          {
            title: "Stage 1: on-chain yield (under $1M)",
            body: "Delta-neutral strategies, yield vaults, lending and liquid staking, plus buybacks and a cash reserve. Everything stays liquid.",
          },
          {
            title: "Stage 2: adding real-world assets ($1M to $10M)",
            body: "Part of the Fund moves into tokenized stocks and tokenized government bonds, for returns that don't depend only on crypto.",
          },
          {
            title: "Stage 3: backing companies ($10M and up)",
            body: "A slice goes into direct stakes in companies, from early-stage angel investments to shares in growing businesses, held for the long term.",
          },
        ]}
      />
      <ChartCard title="Target allocation at each stage" caption="Indicative targets. The actual mix at each stage will be published here before the Fund moves into it.">
        <div className="flex flex-col gap-7">
          <div>
            <p className="mb-3 text-[15px] font-medium text-ink">Stage 1 · under $1M</p>
            <SplitBar
              data={[
                { label: "Delta-neutral", value: 30, color: "#0a0a0a" },
                { label: "Yield vaults", value: 25, color: "#2f7d1c" },
                { label: "$PEN buybacks", value: 15, color: "#1c3a28" },
                { label: "Lending", value: 15, color: "#7ed957" },
                { label: "Liquid staking", value: 10, color: "#b8ff9d" },
                { label: "Cash reserve", value: 5, color: "#d8d2c2" },
              ]}
            />
          </div>
          <div>
            <p className="mb-3 text-[15px] font-medium text-ink">Stage 2 · $1M to $10M</p>
            <SplitBar
              data={[
                { label: "Delta-neutral", value: 25, color: "#0a0a0a" },
                { label: "Tokenized stocks and bonds", value: 20, color: "#5b8def" },
                { label: "Yield vaults", value: 20, color: "#2f7d1c" },
                { label: "$PEN buybacks", value: 15, color: "#1c3a28" },
                { label: "Lending", value: 10, color: "#7ed957" },
                { label: "Liquid staking", value: 5, color: "#b8ff9d" },
                { label: "Cash reserve", value: 5, color: "#d8d2c2" },
              ]}
            />
          </div>
          <div>
            <p className="mb-3 text-[15px] font-medium text-ink">Stage 3 · $10M and up</p>
            <SplitBar
              data={[
                { label: "Delta-neutral", value: 20, color: "#0a0a0a" },
                { label: "Tokenized stocks and bonds", value: 20, color: "#5b8def" },
                { label: "Company and angel investments", value: 15, color: "#e8a33c" },
                { label: "Yield vaults", value: 15, color: "#2f7d1c" },
                { label: "$PEN buybacks", value: 15, color: "#1c3a28" },
                { label: "Lending", value: 5, color: "#7ed957" },
                { label: "Liquid staking", value: 5, color: "#b8ff9d" },
                { label: "Cash reserve", value: 5, color: "#d8d2c2" },
              ]}
            />
          </div>
        </div>
      </ChartCard>
      <Callout tone="warn" title="Bigger stages carry different risks">
        Company and angel investments can take years to pay off, can&apos;t be sold quickly, and often fail completely. Tokenized stocks follow the stock
        market and aren&apos;t available everywhere. That&apos;s why these stages only start once the Fund is large enough to keep most of its money liquid, and
        why the cash reserve never drops below 5%.
      </Callout>

      <H2>How the Fund rotates</H2>
      <P>
        Rates move all the time, so the Fund doesn&apos;t sit still. It reviews its positions regularly and moves money when a better risk-adjusted rate
        opens up, using the same live rates you see in the app.
      </P>
      <Steps
        items={[
          { title: "Compare", body: "Every strategy's current rate is compared, after fees, against the alternatives in its bucket." },
          { title: "Check the risk", body: "A higher rate only counts if it fits the Fund's limits: liquidity, track record and how much is already there." },
          { title: "Move", body: "Money moves when the gain is worth the cost of moving it. Small differences aren't chased." },
          { title: "Publish", body: "Every change in allocation is shown on this page." },
        ]}
      />

      <H3>Risk limits</H3>
      <List
        items={[
          "No more than 25% of the Fund in any single protocol.",
          "No more than 15% of the Fund in any single vault or market.",
          "At least 5% kept in stablecoins as a cash reserve for payouts.",
          "On-chain, only products Pecun lists, with deep liquidity and a track record.",
          "Tokenized assets and company investments only from the stages below, once the Fund is big enough.",
          "Leverage only inside delta-neutral strategies, where it's hedged.",
          "Buybacks capped at 15% of the Fund.",
        ]}
      />

      <H2>Your share</H2>
      <P>Your share of the Fund is simple: the tokens you hold, divided by the $PEN in circulation, times what the Fund is worth. The supply starts at 1,000,000,000 and shrinks as buybacks burn tokens.</P>
      <div className="rounded-2xl bg-[#f5f8ef] px-5 py-4 text-center font-tight text-[1.15rem] font-medium tracking-[-0.01em] text-ink sm:text-[1.3rem]">
        Your share = (your $PEN ÷ $PEN in circulation) × Fund value
      </div>
      <ChartCard title="Work out your share" caption="Change the numbers to try it. Uses the full 1,000,000,000 supply; burns make real shares a little bigger. The Fund value is only an example, not a forecast.">
        <ShareCalculator />
      </ChartCard>

      <H2>Getting paid when you sell</H2>
      <P>
        When you sell $PEN, the contract pays you your share of the Fund automatically, on top of what you get for the tokens. Your share is worked out
        from the Fund&apos;s value at that moment, so it includes whatever the Fund has earned while you held, or reflects what it has lost.
      </P>
      <List
        items={[
          "Nothing to claim: the payout happens in the same sale.",
          "Paid from the cash reserve first, so sellers don't have to wait for a strategy to unwind.",
          "The 3% tax still applies to the sale, and 70% of it goes back into the Fund for the holders who stay.",
        ]}
      />

      <H2>Transparency and reporting</H2>
      <List
        items={[
          "The Fund's wallet address is published here, so anyone can see its balance and positions on-chain.",
          "The live allocation chart replaces the target chart above once the Fund is running.",
          "Every move between strategies is listed, with the date, the amount and the reason.",
          "Every buyback and burn is listed, with the amount spent and the tokens burned.",
          "A regular report shows tax collected, what went to running costs, yield earned, payouts made and the Fund's value.",
        ]}
      />

      <H2>Risks</H2>
      <Callout tone="warn" title="The Fund can lose money">
        The Fund invests in on-chain products. Smart-contract failures, depegs, negative funding, failed hedges and market moves can all reduce its value,
        and past yield doesn&apos;t predict future yield. Your share of the Fund is not a deposit or a guaranteed amount, and $PEN&apos;s price can fall.
        Nothing here is investment advice. Read <A href="/risks">Risks</A>, and the $PEN terms when they&apos;re published, before you buy.
      </Callout>

      <H2>Questions about the Fund</H2>
      <Facts
        rows={[
          ["Can Pecun take money out of the Fund?", "No. Pecun's running costs come from its 30% of the tax, before anything reaches the Fund. The Fund is only for investing and for paying holders, and its wallet and every movement are public."],
          ["What if a strategy loses money?", "The Fund's value goes down, and so does every holder's share. Spreading money across strategies and protocols is how the Fund limits that."],
          ["Does the Fund buy $PEN?", "Yes, with 15% of the Fund. Bought-back tokens are burned, which shrinks the supply and raises every remaining holder's share."],
          ["Where are the numbers?", "On this page: the Fund's wallet, the live allocation and regular reports, once it's running."],
        ]}
      />
    </Doc>
  );
}
