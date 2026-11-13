# Weekly review of bad AI results

Why a result was bad can only be learned from what the model was asked and what it said back (#994). Every OpenRouter call carries its step, its run and a hashed person id (#985), and OpenRouter Broadcast sends a trace of each call to PostHog.

## Two keys, two kinds of trace

| | Production | Staging |
| --- | --- | --- |
| OpenRouter key | Prod's own | A separate key, used only by staging |
| Broadcast destination | PostHog, Privacy Mode on: counts, timing, cost, no text | PostHog, Privacy Mode off: full prompt and reply text |

Full text never leaves OpenRouter for production users. Staging holds Eric's and test accounts only.

### Setup (Eric, once)

1. In OpenRouter, make a new API key named `lookout-staging`.
2. Put it in staging's settings (Admin > AI on staging.lookout.ericdevlin.co, or `AI_API_KEY` in `/opt/lookout-staging/.env`). Prod keeps its key.
3. In OpenRouter > Settings > Broadcast, add a second PostHog destination limited to the staging key, with Privacy Mode off. Keep the prod destination as it is.
4. Check: run a search on staging, then in PostHog find the trace whose id is the run id. It should show the prompt and reply.

## The weekly list

`GET /api/agent/bad-results?since=<ISO time>&limit=50` (staging only, same token as `/api/agent/errors`, `AGENT_ERRORS_TOKEN`). `since` defaults to 7 days ago. It returns:

- `failedRuns`: searches, link adds and other runs that failed, with the error and the last step.
- `failedApps`: applications that failed, with the error.
- `notAFit`: finds a person marked "Not a fit", highest score first. A high score the person rejected is the worst miss.

Each item has `traceId`. In PostHog, filter LLM traces by that trace id to read the calls. Searches and link adds use the run id; applications, redrafts and reviews use the application id.

## Each week

1. Pull the list for the last 7 days.
2. Take the worst 5 to 10: every failed run or application, then the highest-scored "Not a fit" finds.
3. For each, open the trace and write one line: what went wrong, and whether the prompt, the model or the code is at fault.
4. File a GitHub issue for anything that needs a fix. Add the postings to the 50-posting eval set when they show a new kind of miss.
5. Post the notes on the week's review task.
