"use server";

import { checkNote, type NoteState } from "@/lib/note";

/** Checks the footer form. A valid note is not stored on the server; the browser keeps it for the thank-you page. */
export async function submitNote(_prev: NoteState, formData: FormData): Promise<NoteState> {
  const email = String(formData.get("email") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const problem = checkNote(email, message);
  if (problem) return problem;
  return { ok: true, email, message };
}
