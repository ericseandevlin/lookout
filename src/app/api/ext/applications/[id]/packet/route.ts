import { readFile } from "node:fs/promises";
import path from "node:path";
import { HttpError, json } from "@/lib/api";
import { ownApplication } from "@/lib/application/review";
import { preparePacket } from "@/lib/application/submit";
import { extensionRoute } from "@/lib/extension";

type Ctx = { params: Promise<{ id: string }> };

/** The approved answers and Word files for one application, in form order, for the extension to fill (#169). */
export const GET = extensionRoute<Ctx>(async (_req, { user, params }) => {
  const a = await ownApplication(user.id, (await params).id);
  if (a.status !== "approved" && a.status !== "manual")
    throw new HttpError(
      409,
      a.status === "submitted"
        ? "Already submitted."
        : "Approve every required item first.",
    );
  const { steps, opp } = await preparePacket(a.id);
  return json({
    id: a.id,
    company: opp?.company ?? "",
    title: opp?.title ?? "",
    phoneCountry: "United States",
    steps: await Promise.all(
      steps.map(async ({ file, ...s }) => ({
        ...s,
        ...(file
          ? {
              file: {
                name: path.basename(file),
                base64: (await readFile(file)).toString("base64"),
              },
            }
          : {}),
      })),
    ),
  });
});
