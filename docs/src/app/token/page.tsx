import type { Metadata } from "next";
import { ChartCard, Donut, SplitBar } from "@/components/charts";
import { A, Callout, Doc, Facts, H2, List, P, Steps } from "@/components/chrome";

export const metadata: Metadata = {
  title: "$PEN token",
  description: "$PEN, the Pecun token on Robinhood Chain: supply, the 3% tax and the Pecun Fund it pays into.",
};

export default function Token() {
  return (
    <Doc href="/token">
      <P>
        $PEN is the Pecun token, launching on Robinhood Chain. Every trade pays a 3% tax. 70% of it goes into the Pecun Fund, a pool that Pecun puts to work in yield vaults across
        the protocols it lists, and 30% pays for running Pecun. Holders own a share of the Fund in proportion to how many tokens they hold. The idea is a pool that keeps working for everyone who
        holds, much like a long-term national savings fund.
      </P>

      <H2>At a glance</H2>
      <Facts
        rows={[
          ["Ticker", "$PEN"],
          ["Total supply", "1,000,000,000 PEN at launch, shrinking as buybacks burn tokens."],
          ["Launch", "Fair launch on Robinhood Chain, with no presale."],
          ["Network", "Robinhood Chain"],
          ["Tax", "3% on each trade: 70% to the Pecun Fund, 30% to running costs."],
          ["Contract address", "Published here at launch. Don't trust any address you see elsewhere first."],
        ]}
      />

      <H2>Fair launch</H2>
      <P>
        $PEN launches fairly: no presale, no private rounds and no early allocations sold at a discount. Everyone gets the same price, at the same
        time, from the same pool.
      </P>
      <ChartCard title="Supply at launch" caption="All 1,000,000,000 $PEN go to the public launch.">
        <SplitBar data={[{ label: "Public fair launch", value: 100, color: "#2f7d1c", note: "1,000,000,000 $PEN" }]} />
      </ChartCard>

      <H2>The 3% tax</H2>
      <P>
        Every $PEN trade, buy or sell, pays a 3% tax. The other 97% goes through as normal. Of the tax, 70% goes into the Fund that holders own and 30%
        pays for running Pecun: the team, infrastructure, security audits and the network fees Pecun covers.
      </P>
      <ChartCard title="Where each trade goes" caption="Out of every $100 traded, $3 is tax.">
        <Donut
          data={[
            { label: "Trade goes through", value: 97, color: "#0a0a0a", note: "$97 of every $100 traded." },
            { label: "Tax", value: 3, color: "#b8ff9d", note: "$3 of every $100: $2.10 to the Fund, $0.90 to running costs." },
          ]}
          center="3%"
          sub="tax on every trade"
        />
      </ChartCard>
      <ChartCard title="Where the tax goes" caption="Running costs and the Fund are reported side by side.">
        <SplitBar
          data={[
            { label: "Pecun Fund", value: 70, color: "#2f7d1c", note: "Invested in vaults and strategies for holders." },
            { label: "Running costs", value: 30, color: "#0a0a0a", note: "The team, infrastructure, audits and network fees." },
          ]}
        />
      </ChartCard>

      <H2>How the Pecun Fund works</H2>
      <Steps
        items={[
          { title: "The tax comes in", body: "Every $PEN trade pays 3%, and 70% of it goes to the Pecun Fund." },
          {
            title: "The Fund is put to work",
            body: (
              <>
                The Fund deposits into yield vaults, lending markets and staking products from the protocols Pecun lists, and moves between them over time
                to chase better rates. 15% goes to buying back $PEN and burning it. See <A href="/protocols">Supported protocols</A>.
              </>
            ),
          },
          { title: "Its value moves with the vaults", body: "The Fund grows when its positions earn and shrinks if they lose value. Rates change all the time." },
          { title: "You own a share", body: "Your share of the Fund is the number of tokens you hold divided by the $PEN in circulation." },
        ]}
      />

      <P>
        The full story, with the allocation chart, each strategy, the risk limits and a share calculator, is on the <A href="/fund">Pecun Fund</A> page.
      </P>

      <H2>When you sell</H2>
      <P>
        When you sell $PEN, you&apos;re automatically paid your share of the Fund on top of the sale: the part of the Fund that your tokens represent,
        including whatever yield the Fund has earned, or minus what it has lost.
      </P>
      <P>
        For example, holding 1,000,000 PEN is 0.1% of the supply. If the Fund were worth $500,000 when you sold, your share would be $500. That
        figure is only an illustration: the Fund&apos;s real value depends on how much tax it has collected and how its positions perform.
      </P>

      <H2>Transparency</H2>
      <List
        items={[
          "The Fund's wallet address will be published here, so anyone can see what it holds.",
          "Its positions and the vaults it uses will be listed on this page and updated as they change.",
          "The token's contract address will be published here at launch.",
        ]}
      />

      <Callout tone="warn" title="Read this before you buy">
        $PEN is not a deposit, a savings account or a promise of returns. The Fund invests in on-chain products that carry real risk: smart-contract
        failures, depegs and market losses can reduce its value, and the token&apos;s price can fall. The 3% tax is paid on every trade. Nothing here is
        investment advice. $PEN won&apos;t be available in the regions listed in <A href="/availability">Availability</A>, and its own terms and risks will
        be published before launch. See also <A href="/risks">Risks</A>.
      </Callout>

      <Callout tone="warn" title="Watch out for fakes">
        Until the contract address is published on this page, any token, airdrop or claim page calling itself $PEN or Pecun is not ours. Pecun will
        never ask you to send funds to receive tokens, and will never ask for your login codes or passkey.
      </Callout>
    </Doc>
  );
}
