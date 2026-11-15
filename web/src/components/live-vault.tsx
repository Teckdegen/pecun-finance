"use client";

import { useEffect, useRef, useState } from "react";
import { pct, type Featured } from "@/lib/live";

/** Rotates through live vaults so the card names more than the first one. */
export function LiveVault({ vaults }: { vaults: Featured[] }) {
  const list = vaults.filter((v) => v.apy > 0).slice(0, 8);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(true);

  const box = useRef<HTMLDivElement>(null);
  const visible = useRef(false);

  // Only rotate while the card is on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (list.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let fade: number | undefined;
    const id = window.setInterval(() => {
      if (document.hidden || !visible.current) return;
      setShown(false);
      fade = window.setTimeout(() => {
        setI((n) => (n + 1) % list.length);
        setShown(true);
      }, 280);
    }, 3400);
    return () => {
      window.clearInterval(id);
      if (fade) window.clearTimeout(fade);
    };
  }, [list.length]);

  const v = list[i];
  if (!v) {
    return (
      <>
        <p className="text-sm text-[#3d4a34]">Live rate</p>
        <p className="mt-3 tabular text-[4rem] font-medium leading-none tracking-[-0.05em] sm:text-[4.75rem]">—</p>
        <h3 className="mt-auto max-w-[12ch] pt-10 text-[1.7rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2rem]">The rate on the vault is live.</h3>
      </>
    );
  }

  return (
    <div ref={box} className="flex flex-1 flex-col">
      <div className={`flex flex-1 flex-col transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`} aria-live="polite">
        <p className="text-sm text-[#3d4a34]">Live · {v.protocol}</p>
        <p className="mt-3 tabular text-[4rem] font-medium leading-none tracking-[-0.05em] sm:text-[4.75rem]">{pct(v.apy)}</p>
        <h3 className="mt-auto max-w-[18ch] pt-10 text-[1.45rem] font-medium leading-[1.12] tracking-[-0.03em] sm:text-[1.75rem]">{v.name}</h3>
      </div>
      {list.length > 1 && (
        <span className="mt-5 flex gap-1.5" aria-hidden>
          {list.map((item, n) => (
            <span key={item.name} className={`h-1 rounded-full transition-all duration-300 ${n === i ? "w-4 bg-ink" : "w-1 bg-ink/20"}`} />
          ))}
        </span>
      )}
    </div>
  );
}
