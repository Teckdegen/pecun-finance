"use client";

/** Last-resort error screen when the root layout itself fails. Has to bring its own <html> and styles. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0c0c0c", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <div role="alert" style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 500, margin: 0 }}>Pecun is having trouble loading.</h1>
          <p style={{ color: "#a3a3a3", fontSize: 14, marginTop: 12 }}>Please try again in a moment. Your positions live on-chain and aren&apos;t affected.</p>
          <button
            onClick={reset}
            style={{ marginTop: 20, height: 40, padding: "0 16px", borderRadius: 12, border: 0, background: "#b8ff9d", color: "#0a0b0d", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
