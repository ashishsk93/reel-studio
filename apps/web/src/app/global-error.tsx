"use client";

/** Last resort when the root layout itself fails: no app styles are guaranteed here. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 40 }}>
        <h1 style={{ fontSize: 20 }}>Reel Studio hit an error</h1>
        <p style={{ color: "#666" }}>{error.message || "Unknown error"}</p>
        <button type="button" onClick={reset} style={{ marginTop: 12, padding: "6px 14px" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
