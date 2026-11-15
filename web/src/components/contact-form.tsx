"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { submitNote } from "@/app/actions";
import { NOTE_KEY, type NoteState } from "@/lib/note";

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-11 w-full items-center justify-center rounded-full bg-ink px-5 text-sm font-medium text-white hover:bg-[#262626] disabled:opacity-60 sm:w-auto"
    >
      {pending ? "Checking…" : "Continue"}
    </button>
  );
}

/** Footer form. Errors come back from the server. A valid note stays in this browser and opens the thank-you page. */
export function ContactForm() {
  const router = useRouter();
  const sent = useRef(false);
  const [state, action] = useActionState(submitNote, {} as NoteState);

  useEffect(() => {
    if (!state.ok || sent.current) return;
    sent.current = true;
    try {
      sessionStorage.setItem(NOTE_KEY, JSON.stringify({ email: state.email, message: state.message }));
    } catch {
      // Private mode: the thank-you page still works, without the prefilled email.
    }
    router.push("/thank-you");
  }, [state, router]);

  const emailError = "field" in state && state.field === "email" ? state.error : undefined;
  const messageError = "field" in state && state.field === "message" ? state.error : undefined;

  return (
    <form action={action} noValidate className="grid gap-3">
      <div>
        <label htmlFor="email" className="text-xs font-medium text-muted">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@email.com"
          aria-invalid={!!emailError}
          aria-describedby={emailError ? "email-error" : undefined}
          className={`mt-1.5 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none placeholder:text-muted/70 ${emailError ? "border-[#9b2c2c]" : "border-line"}`}
        />
        {emailError && (
          <p id="email-error" role="alert" className="mt-1.5 text-xs text-[#9b2c2c]">
            {emailError}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="message" className="text-xs font-medium text-muted">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          placeholder="What can we help with?"
          aria-invalid={!!messageError}
          aria-describedby={messageError ? "message-error" : undefined}
          className={`mt-1.5 w-full resize-y rounded-xl border bg-white px-3 py-2.5 text-sm outline-none placeholder:text-muted/70 ${messageError ? "border-[#9b2c2c]" : "border-line"}`}
        />
        {messageError && (
          <p id="message-error" role="alert" className="mt-1.5 text-xs text-[#9b2c2c]">
            {messageError}
          </p>
        )}
      </div>
      <SendButton />
    </form>
  );
}
