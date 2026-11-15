"use client";

import { useEffect, useState } from "react";
import { NOTE_KEY } from "@/lib/note";
import { APP_URL, LEGAL } from "@/lib/site";

type Note = { email: string; message: string };

/** Reads the note the form left in this browser and offers to send it by email. */
export function ThankYouNote() {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(NOTE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Note;
      if (parsed?.email && parsed?.message) setNote(parsed);
    } catch {
      // Ignore a bad or blocked store.
    }
  }, []);

  const mailto = note
    ? `mailto:${LEGAL.contactEmail}?subject=${encodeURIComponent("Hello from the Pecun site")}&body=${encodeURIComponent(`${note.message}\n\nFrom ${note.email}`)}`
    : `mailto:${LEGAL.contactEmail}`;

  return (
    <>
      <h1 className="text-[1.7rem] font-medium leading-tight tracking-[-0.03em] md:text-[2.2rem]">Thank you.</h1>
      <p className="mt-3 font-sans text-sm leading-relaxed text-muted">
        {note
          ? `Your note is ready to send to ${LEGAL.contactEmail}. It stays in this browser until you close the tab. We don't keep a copy on the site.`
          : `Write to ${LEGAL.contactEmail} and we'll reply there.`}
      </p>
      <div className="mt-6 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <a href={mailto} className="inline-flex h-11 items-center justify-center rounded-full bg-lime px-5 text-sm font-medium text-ink hover:bg-lime-deep">
          Email Pecun
        </a>
        <a href="/" className="inline-flex h-11 items-center justify-center rounded-full border border-line bg-white px-5 text-sm font-medium hover:bg-paper">
          Back home
        </a>
        <a href={APP_URL} className="inline-flex h-11 items-center justify-center rounded-full border border-line bg-white px-5 text-sm font-medium hover:bg-paper">
          Launch App
        </a>
      </div>
    </>
  );
}
