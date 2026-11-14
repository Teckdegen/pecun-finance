import type { ReactNode } from "react";

export type LegalSection = { heading: string; body: ReactNode[]; bullets?: ReactNode[] };

/** Shared layout for /terms and /privacy: readable width, numbered sections. */
export function LegalPage({ title, effective, intro, sections }: { title: string; effective: string; intro: ReactNode; sections: LegalSection[] }) {
  return (
    <article className="mx-auto max-w-3xl pb-8">
      <h1 className="text-[1.7rem] font-medium leading-tight tracking-[-0.03em] md:text-[2rem]">{title}</h1>
      <p className="mt-2 text-sm text-muted">Effective {effective}</p>
      <div className="mt-6 font-sans text-sm leading-relaxed text-ink/85">{intro}</div>
      <ol className="mt-8 grid gap-8">
        {sections.map((s, i) => (
          <li key={s.heading} id={slug(s.heading)} className="scroll-mt-24">
            <h2 className="text-base font-medium text-ink">
              {i + 1}. {s.heading}
            </h2>
            <div className="mt-2 grid gap-3 font-sans text-sm leading-relaxed text-ink/80">
              {s.body.map((p, k) => (
                <p key={k}>{p}</p>
              ))}
              {s.bullets && (
                <ul className="grid list-disc gap-1.5 pl-5">
                  {s.bullets.map((b, k) => (
                    <li key={k}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
