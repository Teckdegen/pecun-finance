import type { Metadata } from "next";
import { Callout, Doc, H2, P } from "@/components/chrome";
import { Logo } from "@/components/logo";
import { PROTOCOLS } from "@/lib/site";

export const metadata: Metadata = { title: "Supported protocols", description: "Every protocol and platform you can earn on through Pecun." };

export default function Protocols() {
  return (
    <Doc href="/protocols">
      <P>
        Pecun lists products from {PROTOCOLS.length} protocols and platforms, from lending markets to vaults, liquid staking and fixed yield. Each one is run
        by an independent team, under its own terms.
      </P>

      <H2>All protocols</H2>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {PROTOCOLS.map((p) => (
          <li key={p.name} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3">
            <Logo src={p.logo} label={p.name} size={36} />
            <span className="min-w-0">
              <span className="block font-tight text-[1.05rem] font-medium tracking-[-0.02em] text-ink">{p.name}</span>
              <span className="block text-sm text-[#8a8a83]">{p.kind}</span>
            </span>
          </li>
        ))}
      </ul>

      <Callout title="Listed doesn't mean endorsed">
        Pecun shows these products so you can compare them. It doesn&apos;t run, audit or guarantee any of them. Each protocol&apos;s own terms and
        risks apply.
      </Callout>
    </Doc>
  );
}
