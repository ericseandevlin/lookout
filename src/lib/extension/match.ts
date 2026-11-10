/**
 * Tell whether the page open in the browser is the job an application is for (#169).
 * A company's careers page often embeds the ATS form in an iframe, so the same job shows up under
 * several URLs: redventures.com/...?gh_jid=8008090, job-boards.greenhouse.io/embed/job_app?token=8008090,
 * boards.greenhouse.io/redventures/jobs/8008090. All of them reduce to one key.
 */
export function jobKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const gh = u.searchParams.get("gh_jid") ?? (/greenhouse\.io$/.test(host) ? (u.searchParams.get("token") ?? u.pathname.match(/\/jobs\/(\d+)/)?.[1]) : null);
  if (gh && /^\d+$/.test(gh)) return `greenhouse:${gh}`;
  const uuid = u.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (uuid && /(ashbyhq\.com|lever\.co)$/.test(host)) return `${host.includes("ashby") ? "ashby" : "lever"}:${uuid.toLowerCase()}`;
  // Workday (#622): the form is at .../job/<location>/<title>_R123/apply/applyManually, with or without a locale prefix.
  const wd = /myworkdayjobs\.com$/.test(host) && u.pathname.match(/\/(?:job|details)\/(?:[^/]+\/)*?([^/]+)\/*(?:\/apply\b.*)?$/i)?.[1];
  if (wd) return `workday:${host}:${decodeURIComponent(wd).toLowerCase()}`;
  const path = u.pathname.replace(/\/(apply|application)\/?$/i, "").replace(/\/+$/, "");
  return `url:${host.replace(/^www\./, "")}${path.toLowerCase()}${idQuery(u.searchParams)}`;
}

// Query params that name the job itself (indeed.com/viewjob?jk=..., careers pages with ?jobId=). Tracking params stay out (#508).
const ID_PARAM = /^(v?jk|id|jid|job|jobs?id|jobreqid|req|reqid|requisitionid|postingid|openingid|positionid|currentjobid|pid)$/;

function idQuery(params: URLSearchParams) {
  const ids = [...params]
    .filter(([k, v]) => v && ID_PARAM.test(k.toLowerCase().replace(/[_-]/g, "")))
    .map(([k, v]) => `${k.toLowerCase().replace(/[_-]/g, "")}=${v.toLowerCase()}`)
    .sort();
  return ids.length ? `?${ids.join("&")}` : "";
}

/** True when any of the page's URLs (top page and frames) is the same job as any of the application's URLs. */
export function sameJob(pageUrls: string[], appUrls: (string | null | undefined)[]): boolean {
  const want = new Set(appUrls.map(jobKey).filter((k): k is string => !!k));
  return pageUrls.some((p) => {
    const k = jobKey(p);
    return !!k && want.has(k);
  });
}
