import type { ReactNode } from "react";

export type LegalBlock = { heading: string; body: ReactNode[]; bullets?: ReactNode[] };
export type LegalSection = LegalBlock & { subsections?: LegalBlock[] };

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Readable legal page: title, date, and numbered sections. */
export function LegalPage({ title, effective, intro, sections }: { title: string; effective: string; intro: ReactNode; sections: LegalSection[] }) {
  return (
    <article>
      <h1 className="text-[1.7rem] font-medium leading-tight tracking-[-0.03em] md:text-[2.2rem]">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {effective}</p>
      <div className="mt-6 grid gap-3 font-sans text-sm leading-relaxed text-ink/85">{intro}</div>
      <ol className="mt-10 grid gap-10">
        {sections.map((s, i) => (
          <li key={s.heading} id={slug(s.heading)} className="scroll-mt-24">
            <h2 className="text-base font-medium">
              {i + 1}. {s.heading}
            </h2>
            <Block b={s} />
            {s.subsections?.map((sub) => (
              <div key={sub.heading} className="mt-5">
                <h3 className="text-sm font-medium">{sub.heading}</h3>
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
