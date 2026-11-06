import { adminRoute, json } from "@/lib/api";
import { metrics } from "@/lib/metricsStore";

/** Admin > Metrics (#36): the beta goals and where they stand. */
export const GET = adminRoute(async () => json(await metrics()));
