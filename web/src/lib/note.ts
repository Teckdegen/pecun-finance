export const NOTE_KEY = "pecun-web-note";

export type NoteError = { ok?: false; field: "email" | "message"; error: string };
export type NoteOk = { ok: true; email: string; message: string };
export type NoteState = NoteError | NoteOk | { ok?: false };

/** Shared by the form and the server action so both reject the same input. */
export function checkNote(email: string, message: string): NoteError | null {
  if (!email) return { field: "email", error: "Enter your email." };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { field: "email", error: "That email doesn't look right." };
  if (!message) return { field: "message", error: "Write a short message." };
  if (message.length > 2000) return { field: "message", error: "Keep the message under 2,000 characters." };
  return null;
}
