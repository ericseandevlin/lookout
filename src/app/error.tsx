"use client";

import { ErrorFrame, ErrorRef, retryStyle } from "@/components/ErrorFrame";

/**
 * A page that threw while rendering (#396). The error is already in Admin > Errors (instrumentation.ts), so this only
 * shows the digest, never the message or stack.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorFrame eyebrow="Something went wrong" title="This page didn't load" action={<button type="button" onClick={reset} style={retryStyle}>Try again</button>}>
      <p style={{ margin: 0 }}>It&apos;s been logged. Try again, or go back to Lookout and come back in a minute.</p>
      <ErrorRef digest={error.digest} />
    </ErrorFrame>
  );
}
