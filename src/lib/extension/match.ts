/**
 * Tell whether the page open in the browser is the job an application is for (#169).
 * A company's careers page often embeds the ATS form in an iframe, so the same job shows up under
 * several URLs: redventures.com/...?gh_jid=8008090, job-boards.greenhouse.io/embed/job_app?token=8008090,
 * boards.greenhouse.io/redventures/jobs/8008090. All of them reduce to one key.
 */
/** A URL part decoded, or as written when it holds a bad escape ("100%-Commission", "%E9"): never a URIError (#1162). */
export const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

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
  // A title that starts with "Apply" ("Apply-Engineer_R5") is the job, not the apply step (1107).
  // wdN.myworkdaysite.com/recruiting/<tenant>/... serves many employers, so the tenant joins the key (#666).
  const wdHost = /myworkdayjobs\.com$/.test(host) ? host : /myworkdaysite\.com$/.test(host) ? `${host}/${u.pathname.match(/\/recruiting\/([^/]+)/i)?.[1]?.toLowerCase() ?? ""}` : null;
  const wd = wdHost && u.pathname.match(/\/(?:job|details)\/(?:[^/]+\/)*?([^/]+)\/*(?:\/apply(?:\/.*)?)?$/i)?.[1];
  if (wd) return `workday:${wdHost}:${safeDecode(wd).toLowerCase()}`;
  // iCIMS (#852): careers-acme.icims.com/jobs/1234/<title>/job, then .../login and .../candidate on the way to the form.
  const icims = /(^|\.)icims\.com$/.test(host) && u.pathname.match(/^\/jobs\/(\d+)(?:\/|$)/i)?.[1];
  if (icims) return `icims:${host}:${icims}`;
  // Workable (#1522): the shortcode after /j/ names the job alone, on apply.workable.com/<company>/j/, the /j/ short link
  // and the old <company>.workable.com/j/.
  const workable = /(^|\.)workable\.com$/.test(host) && u.pathname.match(/\/j\/([0-9a-z]{6,})(?:\/|$)/i)?.[1];
  if (workable) return `workable:${workable.toLowerCase()}`;
  // Teamtailor (#1522): /jobs/<id>-<title> with or without the title, the form at .../applications/new.
  const teamtailor = /(^|\.)teamtailor\.com$/.test(host) && u.pathname.match(/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/jobs\/(\d+)(?:-[^/]*)?(?:\/applications\/new)?\/?$/i)?.[1];
  if (teamtailor) return `teamtailor:${host}:${teamtailor}`;
  // Paylocity (#1435): the posting is /Recruiting/Jobs/Details/<id> and its form /Recruiting/Jobs/Apply/<id>. The ID is
  // site-wide; the URL names no employer.
  const paylocity = /(^|\.)paylocity\.com$/.test(host) && u.pathname.match(/\/jobs\/(?:details|apply)\/(\d+)(?:\/|$)/i)?.[1];
  if (paylocity) return `paylocity:${paylocity}`;
  // Dayforce (#1671): jobs.dayforcehcm.com/[<locale>/]<tenant>/<portal>/jobs/<id>[/apply], with or without a locale, and
  // the older <pod>.dayforcehcm.com/CandidatePortal/<locale>/<tenant>/Posting/View/<id>. The tenant joins the key.
  const dayforce =
    /(^|\.)dayforcehcm\.com$/.test(host) &&
    (u.pathname.match(/\/([^/]+)\/[^/]+\/jobs\/(\d+)(?:\/apply)?\/?$/i) ??
      u.pathname.match(/^\/candidateportal\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?([^/]+)\/(?:[^/]+\/)*posting\/(?:view|apply)\/(\d+)\/?$/i));
  if (dayforce) return `dayforce:${safeDecode(dayforce[1]).toLowerCase()}:${dayforce[2]}`;
  // SmartRecruiters (#1520): /<company>/<15-digit id>, with or without the title slug after it, on jobs. or careers.
  const sr = /(^|\.)smartrecruiters\.com$/.test(host) && u.pathname.match(/^\/([^/]+)\/(\d{10,})(?:-[^/]*)?\/?$/);
  if (sr) return `smartrecruiters:${safeDecode(sr[1]).toLowerCase()}:${sr[2]}`;
  // Taleo (#1497): the posting is /careersection/<section>/jobdetail.ftl?job=<id> and its form jobapply.ftl?job=<id>.
  const taleo = /(^|\.)taleo\.net$/.test(host) && /\/job(detail|apply)\.ftl$/i.test(u.pathname) && u.searchParams.get("job");
  if (taleo) return `taleo:${host}:${taleo.toLowerCase()}`;
  // Indeed (#1578): one job is viewjob?jk=<id> with any mix of from=, vjs=, tk= after it, or ?vjk=<id> on a search page.
  const indeed = /(^|\.)indeed\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) && (u.searchParams.get("jk") ?? u.searchParams.get("vjk"))?.match(/^[0-9a-f]{16}$/i)?.[0];
  if (indeed) return `indeed:${indeed.toLowerCase()}`;
  // LinkedIn (#1578): /jobs/view/<id> and /jobs/view/<title>-at-<company>-<id> are the same posting. So is the job open
  // beside a search or a collection, /jobs/search/?currentJobId=<id> (#1583). Job alert emails link /comm/jobs/view/<id> (#1672).
  const linkedin =
    /(^|\.)linkedin\.com$/.test(host) && (u.pathname.match(/^(?:\/comm)?\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/i)?.[1] ?? u.searchParams.get("currentJobId")?.match(/^\d{6,}$/)?.[0]);
  if (linkedin) return `linkedin:${linkedin}`;
  // Glassdoor (#1605): partner/jobListing.htm?jobListingId=<id>, and ?jl=<id> on a listing page or beside a search. The
  // path alone is the same for every job, so without the ID all of them would be one job.
  const glassdoor =
    /(^|\.)glassdoor\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) && (u.searchParams.get("jobListingId") ?? u.searchParams.get("jl"))?.match(/^\d{6,}$/)?.[0];
  if (glassdoor) return `glassdoor:${glassdoor}`;
  // Recruitee's form is at /o/<job>/c/new and Teamtailor's at /jobs/<id>-<title>/applications/new: apply steps too (#1200).
  // Teamtailor on its own host is keyed by ID above; a company's own domain still comes here.
  // UltiPro's posting is .../JobBoard/<board>/OpportunityDetail?opportunityId=<id> and its form OpportunityApply (#1497).
  const step = /(^|\.)ultipro\.com$/.test(host) ? /\/(opportunitydetail|opportunityapply)\/?$/i : /\/(apply|application|c\/new|applications\/new)\/?$/i;
  const path = u.pathname.replace(step, "").replace(/\/+$/, "");
  return `url:${host.replace(/^www\./, "")}${path.toLowerCase()}${idQuery(u.searchParams)}${hashRoute(u)}`;
}

/**
 * The fragment when the page routes by it (careers.acme.com/#/jobs/101, #!/job/202), so each job there keeps a key of its
 * own (#841). The apply step at the end goes, like in the path. A plain anchor like #apply names no job and drops. A query
 * inside the hash keeps only its job ID params, so "#/jobs/101?utm_source=linkedin" is the same job as "#/jobs/101" (#1375).
 */
export function hashRoute(u: URL) {
  if (!/^#!?\//.test(u.hash)) return "";
  const q = u.hash.indexOf("?");
  const route = q < 0 ? u.hash : u.hash.slice(0, q);
  const query = q < 0 ? "" : u.hash.slice(q + 1);
  return route.replace(/\/(apply|application)\/?$/i, "").replace(/\/+$/, "").toLowerCase() + idQuery(new URLSearchParams(query));
}

// Query params that name the job itself (indeed.com/viewjob?jk=..., careers pages with ?jobId=, UltiPro ?opportunityId=,
// SuccessFactors ?career_job_req_id= (#840), Phenom's apply page ?jobSeqNo= (#1584), ?jobRequisitionId= (#1605)). Tracking params stay out (#508).
const ID_PARAM = /^(v?jk|id|jid|job|jobs?id|jobreqid|careerjobreqid|req|reqid|requisitionid|jobrequisitionid|postingid|openingid|opportunityid|positionid|currentjobid|pid|jobseqno)$/;
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
