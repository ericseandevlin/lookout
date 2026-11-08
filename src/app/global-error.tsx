"use client";

import "./globals.css";
import { ErrorFrame, ErrorRef, retryStyle } from "@/components/ErrorFrame";

/** An error in the root layout itself (#396). It replaces the layout, so it brings its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorFrame eyebrow="Something went wrong" title="Lookout didn't load" action={<button type="button" onClick={reset} style={retryStyle}>Try again</button>}>
          <p style={{ margin: 0 }}>It&apos;s been logged. Try again in a minute.</p>
          <ErrorRef digest={error.digest} />
        </ErrorFrame>
      </body>
    </html>
  );
}
