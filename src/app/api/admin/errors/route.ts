import { adminRoute, json } from "@/lib/api";
import { listErrors } from "@/lib/errorLog";

/** Admin > Errors (#12). ?q= searches message, path, source and digest. */
export const GET = adminRoute(async (req) => json(await listErrors(new URL(req.url).searchParams.get("q") ?? "")));
