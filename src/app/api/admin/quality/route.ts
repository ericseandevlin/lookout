import { adminRoute, json } from "@/lib/api";
import { findsQuality } from "@/lib/qualityStore";

/** Are finds any good (#31): what people did with the finds Lookout added. */
export const GET = adminRoute(async () => json(await findsQuality()));
