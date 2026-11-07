import "server-only";
import { kindOf } from "@/lib/kinds";

/** SAM.gov needs a free API key from a SAM.gov account (#272); rfp discovery is off until it's set. */
export const samConfigured = () => (process.env.SAM_API_KEY ?? "").length > 10;

/** Whether "Search now" and the scheduler can run a search of this kind. */
export const searchOn = (kind: string) => kindOf(kind).discovery || (kind === "rfp" && samConfigured());
