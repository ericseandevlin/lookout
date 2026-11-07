/**
 * Named colors for inline styles. Values match the CSS variables in
 * src/app/globals.css; keep the two in step. Use these instead of hex
 * literals so contrast is checked in one place (tokens.test.ts).
 */
export const color = {
  ink: "#1D1A0F", // body text, primary buttons
  t2: "#6B6358", // secondary text
  t3: "#8A8175",
  muted: "#A89F92", // decorative only, not for text on white
  onDark: "#C9C1B5",
  brick: "#99220F", // errors, destructive actions
  orange: "#F8A865", // accent, focus ring
  peachInk: "#7A3A10",
  green: "#427D33",
  page: "#EFEEEC",
  border: "#E6E0D8", // card and input borders
} as const;
