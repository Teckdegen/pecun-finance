import type { ReactNode } from "react";
import { Footer } from "./chrome";

export type LegalBlock = { heading: string; body: ReactNode[]; bullets?: ReactNode[] };
export type LegalSection = LegalBlock & { subsections?: LegalBlock[] };

/** Shared layout for the Terms, the Privacy Policy and the Risk Disclosure: numbered sections and subsections. */
export function LegalPage({
  title,
  subtitle,
  effective,
  intro,
  sections,
  contents = false,
}: {
  title: string;
  subtitle?: string;
  effective: string;
  intro: ReactNode;
  sections: LegalSection[];
  /** Show a numbered list of sections at the top (for long documents). */
  contents?: boolean;
}) {
  return (
    <article className="min-w-0 flex-1 py-8 lg:py-12">
      <div className="max-w-3xl">
        <h1 className="text-[2.4rem] font-medium leading-[1.05] tracking-[-0.045em] sm:text-[3.25rem]">{title}</h1>
        {subtitle && <p className="mt-3 text-lg text-[#5e5e58]">{subtitle}</p>}
        <p className="mt-3 text-sm text-[#8a8a83]">Last updated {effective}</p>
        <div className="mt-8 grid gap-4 font-sans text-[16px] leading-[1.75] text-[#3a3a36]">{intro}</div>

        {contents && (
          <nav aria-label="Contents" className="mt-10 rounded-2xl border border-line bg-paper px-5 py-4">
            <p className="font-tight font-medium text-ink">Contents</p>
            <ol className="mt-3 grid gap-1.5 font-sans text-[15px] sm:grid-cols-2">
              {sections.map((s, i) => (
                <li key={s.heading}>
                  <a href={`#${slug(s.heading)}`} className="text-[#5e5e58] hover:text-ink">
                    {i + 1}. {s.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <ol className="mt-12 grid gap-12">
          {sections.map((s, i) => (
            <li key={s.heading} id={slug(s.heading)} className="scroll-mt-24">
              <h2 className="font-tight text-[1.45rem] font-medium tracking-[-0.03em] text-ink sm:text-[1.6rem]">
                {i + 1}. {s.heading}
              </h2>
              <Block b={s} />
              {s.subsections?.map((sub, k) => (
                <div key={sub.heading} id={slug(`${s.heading}-${sub.heading}`)} className="mt-6 scroll-mt-24">
                  <h3 className="font-tight text-[1.1rem] font-medium tracking-[-0.02em] text-ink">
                    {i + 1}.{k + 1} {sub.heading}
                  </h3>
                  <Block b={sub} />
                </div>
              ))}
            </li>
          ))}
        </ol>
        <Footer />
      </div>
    </article>
  );
}

function Block({ b }: { b: LegalBlock }) {
  if (!b.body.length && !b.bullets) return null;
  return (
    <div className="mt-3 grid gap-4 font-sans text-[16px] leading-[1.75] text-[#3a3a36]">
      {b.body.map((p, k) => (
        <p key={k}>{p}</p>
      ))}
      {b.bullets && (
        <ul className="grid list-disc gap-2 pl-5 marker:text-[#2f7d1c]">
          {b.bullets.map((x, k) => (
            <li key={k}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
