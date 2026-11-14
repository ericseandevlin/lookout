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
  green: "#427D33", // fills: toggles, dots. Not for text on the page color
  greenText: "#35662A", // success text
  page: "#EFEEEC",
  border: "#E6E0D8", // card, input and divider borders
  surface: "#F4F1EC", // light fills: chips, tracks, selected and hover rows
} as const;

/**
 * The type scale (#1232). Every font size in src/components and src/app
 * comes from here, as `fontSize: font.base`. The same steps are CSS
 * variables in src/app/globals.css (--text-xs and so on) for CSS modules;
 * keep the two in step.
 *
 * Not on the scale, on purpose: the fluid clamp() display headlines on
 * the landing and /next pages, and DocPreview, which draws the résumé at
 * the sizes the .docx export uses.
 */
export const font = {
  "2xs": 10, // glyphs and miniatures only (caret icons, the landing browser mock); not for reading
  xs: 12, // eyebrows, chips, badges, meta
  sm: 13, // secondary text, table meta, small buttons
  base: 14, // body text and most buttons
  md: 15, // form fields, larger body
  lg: 16, // field labels, card titles, lead buttons
  xl: 18, // section headings, status lines
  "2xl": 21, // dialog, drawer and panel titles
  "3xl": 24, // wordmark in page headers
  "4xl": 28, // page titles and big numbers
} as const;
