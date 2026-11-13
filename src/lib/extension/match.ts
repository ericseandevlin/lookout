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
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  // Company pages that embed Ashby name the job in ?ashby_jid=, like Greenhouse's gh_jid (#639).
  const ashbyJid = u.searchParams.get("ashby_jid")?.match(UUID)?.[0];
  if (ashbyJid) return `ashby:${ashbyJid.toLowerCase()}`;
  const uuid = u.pathname.match(UUID)?.[0];
  if (uuid && /(ashbyhq\.com|lever\.co)$/.test(host)) return `${host.includes("ashby") ? "ashby" : "lever"}:${uuid.toLowerCase()}`;
  // Workday (#622): the form is at .../job/<location>/<title>_R123/apply/applyManually, with or without a locale prefix.
  // wdN.myworkdaysite.com/recruiting/<tenant>/... serves many employers, so the tenant joins the key (#666).
  const wdHost = /myworkdayjobs\.com$/.test(host) ? host : /myworkdaysite\.com$/.test(host) ? `${host}/${u.pathname.match(/\/recruiting\/([^/]+)/i)?.[1]?.toLowerCase() ?? ""}` : null;
  const wd = wdHost && u.pathname.match(/\/(?:job|details)\/(?:[^/]+\/)*?([^/]+)\/*(?:\/apply\b.*)?$/i)?.[1];
  if (wd) return `workday:${wdHost}:${decodeURIComponent(wd).toLowerCase()}`;
  // iCIMS (#852): careers-acme.icims.com/jobs/1234/<title>/job, then .../login and .../candidate on the way to the form.
  const icims = /(^|\.)icims\.com$/.test(host) && u.pathname.match(/^\/jobs\/(\d+)(?:\/|$)/i)?.[1];
  if (icims) return `icims:${host}:${icims}`;
  const path = u.pathname.replace(/\/(apply|application)\/?$/i, "").replace(/\/+$/, "");
  return `url:${host.replace(/^www\./, "")}${path.toLowerCase()}${idQuery(u.searchParams)}${hashRoute(u)}`;
}

/**
 * The fragment when the page routes by it (careers.acme.com/#/jobs/101, #!/job/202), so each job there keeps a key of its
 * own (#841). The apply step at the end goes, like in the path. A plain anchor like #apply names no job and drops.
 */
export function hashRoute(u: URL) {
  return /^#!?\//.test(u.hash) ? u.hash.replace(/\/(apply|application)\/?$/i, "").replace(/\/+$/, "").toLowerCase() : "";
}

// Query params that name the job itself (indeed.com/viewjob?jk=..., careers pages with ?jobId=, UltiPro ?opportunityId=,
// SuccessFactors ?career_job_req_id= (#840)). Tracking params stay out (#508).
const ID_PARAM = /^(v?jk|id|jid|job|jobs?id|jobreqid|careerjobreqid|req|reqid|requisitionid|postingid|openingid|opportunityid|positionid|currentjobid|pid)$/;
// Params that name the employer on a host many employers share: SuccessFactors ?company=, Brassring ?partnerid= (#895).
// Req IDs there are small per-employer numbers, so they join the key whenever a job ID does.
const TENANT_PARAM = /^(company|partnerid)$/;

function idQuery(params: URLSearchParams) {
  const pick = (re: RegExp) =>
    [...params].filter(([k, v]) => v && re.test(k.toLowerCase().replace(/[_-]/g, ""))).map(([k, v]) => `${k.toLowerCase().replace(/[_-]/g, "")}=${v.toLowerCase()}`);
  const ids = pick(ID_PARAM);
  if (!ids.length) return "";
  return `?${[...ids, ...pick(TENANT_PARAM)].sort().join("&")}`;
}

/** True when any of the page's URLs (top page and frames) is the same job as any of the application's URLs. */
export function sameJob(pageUrls: string[], appUrls: (string | null | undefined)[]): boolean {
  const want = new Set(appUrls.map(jobKey).filter((k): k is string => !!k));
  return pageUrls.some((p) => {
    const k = jobKey(p);
    return !!k && want.has(k);
  });
}
