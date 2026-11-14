import type { ReactNode } from "react";

export type LegalBlock = { heading: string; body: ReactNode[]; bullets?: ReactNode[] };
export type LegalSection = LegalBlock & { subsections?: LegalBlock[] };

/** Shared layout for /terms, /privacy and /risk-disclosure: readable width, numbered sections and subsections. */
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
    <article className="mx-auto max-w-3xl pb-8">
      <h1 className="text-[1.7rem] font-medium leading-tight tracking-[-0.03em] md:text-[2rem]">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink/70">{subtitle}</p>}
      <p className="mt-2 text-sm text-muted">Last updated {effective}</p>
      <div className="mt-6 grid gap-3 font-sans text-sm leading-relaxed text-ink/85">{intro}</div>

      {contents && (
        <nav aria-label="Contents" className="mt-8 rounded-xl border border-line bg-card px-4 py-3">
          <p className="text-sm font-medium text-ink">Contents</p>
          <ol className="mt-2 grid gap-1 font-sans text-sm sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.heading}>
                <a href={`#${slug(s.heading)}`} className="text-muted hover:text-ink">
                  {i + 1}. {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <ol className="mt-8 grid gap-10">
        {sections.map((s, i) => (
          <li key={s.heading} id={slug(s.heading)} className="scroll-mt-24">
            <h2 className="text-base font-medium text-ink">
              {i + 1}. {s.heading}
            </h2>
            <Block b={s} />
            {s.subsections?.map((sub, k) => (
              <div key={sub.heading} id={slug(`${s.heading}-${sub.heading}`)} className="mt-5 scroll-mt-24">
                <h3 className="text-sm font-medium text-ink">
                  {i + 1}.{k + 1} {sub.heading}
                </h3>
                <Block b={sub} />
              </div>
            ))}
          </li>
        ))}
      </ol>
    </article>
  );
}

function Block({ b }: { b: LegalBlock }) {
  if (!b.body.length && !b.bullets) return null;
  return (
    <div className="mt-2 grid gap-3 font-sans text-sm leading-relaxed text-ink/80">
      {b.body.map((p, k) => (
        <p key={k}>{p}</p>
      ))}
      {b.bullets && (
        <ul className="grid list-disc gap-1.5 pl-5">
          {b.bullets.map((x, k) => (
            <li key={k}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
