/**
 * The country a phone number dials from, for the Country picker Greenhouse puts beside its phone input (#1794). Every
 * application went out with United States there, so a +44 number reached the employer with the US dial code.
 */

// Dial codes as Greenhouse's picker names the countries. +1 is the US: Canada and the Caribbean share it, and the picker
// only sets the code, so United States dials them all the same.
const DIAL: Record<string, string> = {
  "1": "United States",
  "7": "Russia",
  "20": "Egypt",
  "27": "South Africa",
  "30": "Greece",
  "31": "Netherlands",
  "32": "Belgium",
  "33": "France",
  "34": "Spain",
  "351": "Portugal",
  "352": "Luxembourg",
  "353": "Ireland",
  "354": "Iceland",
  "356": "Malta",
  "357": "Cyprus",
  "358": "Finland",
  "359": "Bulgaria",
  "36": "Hungary",
  "370": "Lithuania",
  "371": "Latvia",
  "372": "Estonia",
  "380": "Ukraine",
  "381": "Serbia",
  "385": "Croatia",
  "386": "Slovenia",
  "39": "Italy",
  "40": "Romania",
  "41": "Switzerland",
  "420": "Czech Republic",
  "421": "Slovakia",
  "43": "Austria",
  "44": "United Kingdom",
  "45": "Denmark",
  "46": "Sweden",
  "47": "Norway",
  "48": "Poland",
  "49": "Germany",
  "52": "Mexico",
  "54": "Argentina",
  "55": "Brazil",
  "56": "Chile",
  "57": "Colombia",
  "60": "Malaysia",
  "61": "Australia",
  "62": "Indonesia",
  "63": "Philippines",
  "64": "New Zealand",
  "65": "Singapore",
  "66": "Thailand",
  "81": "Japan",
  "82": "South Korea",
  "84": "Vietnam",
  "852": "Hong Kong",
  "86": "China",
  "886": "Taiwan",
  "90": "Turkey",
  "91": "India",
  "92": "Pakistan",
  "94": "Sri Lanka",
  "234": "Nigeria",
  "254": "Kenya",
  "971": "United Arab Emirates",
  "972": "Israel",
  "966": "Saudi Arabia",
  "974": "Qatar",
};

export const DEFAULT_PHONE_COUNTRY = "United States";

/**
 * "+44 20 7946 0958" -> "United Kingdom", "0041 44 668 18 00" -> "Switzerland". A number with no international prefix,
 * or a code not listed, is United States, as before.
 */
export function phoneCountry(phone: string | null | undefined): string {
  // A label or bracket may come first: "(+44) 20 ...", "(0049) 30 ...", "Tel: +49 ...", "UK +44 ...", and a full-width
  // plus is a plus (#1819). "(415) 555-0100" has no "+" or "00" after its bracket, so it stays United States.
  const m = (phone ?? "")
    .replace(/＋/g, "+")
    .trim()
    .match(/^[\p{L}.:\s-]*?[([]?\s*(?:\+|00)\s*\(?\s*(\d[\d\s().-]*)/u);
  if (!m) return DEFAULT_PHONE_COUNTRY;
  const digits = m[1].replace(/\D/g, "");
  for (let n = 3; n >= 1; n--) {
    const name = DIAL[digits.slice(0, n)];
    if (name) return name;
  }
  return DEFAULT_PHONE_COUNTRY;
}

/** The phone answer among the fill steps: the first "Phone ..." question, as the pickers look for it. */
export const phoneCountryOf = (steps: { prompt: string; content: string }[]) => phoneCountry(steps.find((s) => /^phone\b/i.test(s.prompt))?.content);

/**
 * An option that is this country: "United Kingdom" or "United Kingdom +44", never "United States Minor Outlying
 * Islands" for United States. Matching source for the worker; the extension builds the same one.
 */
export const countryOption = (name: string) => new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\s*[\\p{L}])`, "iu");
