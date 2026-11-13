# Design decisions

The calls that shaped Lookout, what each one costs, and where it lives in the code. Newest decisions go at the bottom. If a decision changes, edit its entry and say when and why.

## 1. Cheap open models, swappable without a deploy (2026-10-04)

**Decision.** The default model is an open one (DeepSeek through OpenRouter). Any OpenAI-compatible API works, and the admin page can swap the model and key without touching code. Keys are stored encrypted.

**Why.** The beta goal is under $1 per person per month. A frontier model on every search would blow through that.

**Cost.** A small model needs small jobs. Search is split into steps (write queries, pick postings, score a few at a time), and each step has a fallback for when the model answers badly.

**Where.** `src/lib/config.ts`, `src/lib/agent/`.

## 2. Zero data retention by default

**Decision.** AI privacy defaults to `strict`: OpenRouter routes only to hosts that keep nothing and don't train on prompts, US hosts first. `standard` exists but has to be chosen.

**Why.** Resumes and job search goals go through the model. They shouldn't end up stored or trained on by a host nobody picked.

**Cost.** Fewer hosts to choose from, so some models are slower or not available.

**Where.** `privacy` in `src/lib/config.ts`.

## 3. Self-hosted search

**Decision.** Web search goes through SearXNG on the same server.

**Why.** No per-query bill and no third party logging what each person searches for.

**Cost.** One more service to keep running, and result quality depends on the engines SearXNG reaches.

## 4. Hard rules in code, not in the prompt

**Decision.** The model scores each find 1 to 5. Code then applies the rules: a dealbreaker drops the find, a top of range under the pay floor caps it at 3, and a wrong location caps it at 3. Rules can only lower a score.

**Why.** A prompt is a request. A model can talk itself past it, and a small model often does. A rule in code holds every time and is easy to test.

**Cost.** The rules are blunt. A great role just under the floor still shows as a 3, with the reason listed.

**Where.** `applyRules` in `src/lib/agent/rules.ts`.

## 5. Feedback goes back into the search

**Decision.** "Not a fit" asks for a reason. The 12 newest reasons go into the next search, along with notes on finds, so the search profile and the scoring correct themselves over time.

**Why.** People fix a bad match faster by saying what was wrong with one posting than by rewriting their whole profile.

**Cost.** Prompt space on every search, and a careless reason can steer the search the wrong way. The list stays short for that reason.

**Where.** `loadContext` in `src/lib/agent/discover.ts`.

## 6. Staging first, prod once a week (2026-10-14)

**Decision.** Every change is a GitHub issue, a branch and a PR into `main`. `main` deploys to staging. `prod` moves only at the weekly release, with Eric's approval.

**Why.** Testers use prod for their real search. A bad deploy there costs them a morning.

**Cost.** A fix can wait up to a week to reach testers.

**Where.** `CONTRIBUTING.md`, `.githooks/`.

## 7. MIT license (2026-11-10)

**Decision.** Lookout is open source under the MIT License. It was AGPL-3.0 for two days (#424, PR #521) before any release; Eric switched it to MIT (#598).

**Why.** Lookout is a portfolio project, so reach matters most: anyone can read, run, change and reuse it, including at work, with no license review. It matches Taste Engine, which is also MIT.

**Cost.** Someone can run a changed Lookout as a closed hosted service without sharing their changes. AGPL would have prevented that; for a project meant to be shown and reused, that risk is acceptable.

**Where.** `LICENSE`, `license` in `package.json`, the License section of the README, `CONTRIBUTING.md`.

## 8. One shared server until prod outgrows it (2026-11-13, proposed)

**Decision.** Lookout prod and staging stay on the shared VPS (4 CPU, 15 GB RAM, 193 GB disk) with Paperclip, the agents and other tools. Prod moves to its own server when any one of these is true:
- the disk is still over 85% the day after the weekly cleanup (`deploy/disk-prune.sh`),
- prod has 50 active accounts,
- a slow or failed prod request is traced to another tool on the box (memory, CPU or disk), twice in a month,
- someone outside Eric's circle depends on it (a paying user, a group running its search on Lookout).

**Why.** At 5 accounts (2026-11-13) a second server is cost and upkeep with no gain. The triggers are things the server already measures, so the move is a check, not a debate.

**Cost.** Lookout competes with other tools for memory and disk until then. Each app container is capped at 1 GB, the uptime check opens a `capacity` issue when the disk passes 85% (#995), and the weekly cleanup removes only dangling images and old build cache.

**Where.** `src/app/api/health/route.ts` (`disk`), `scripts/uptime-check.sh`, `deploy/disk-prune.sh`, the weekly report in `/opt/lookout-staging/DISK.txt`.

## 9. Run Lookout through an existing LLC (2026-11-07)

**Decision.** Lookout operates under Genius Industries International LLC, Eric's existing company, with Lookout filed as an assumed name. No new LLC (#23, Paperclip ERI-143).

**Why.** It separates Eric's personal assets from the product's liability without the cost and wait of forming and publishing a new company. The Terms limitation of liability means more when a company, not a person, is the operator.

**Cost.** Lookout shares liability with anything else the LLC does. Until the steps below are done, the Terms and Privacy Policy still name Eric personally, and no one can be charged.

**Steps before paid launch (Eric's; agents can't do these):**
1. Confirm the LLC's publication requirement is met and it is in good standing.
2. Confirm the employer's outside-activity policy allows it; keep the work on personal time and equipment.
3. File "Lookout" as an assumed name for the LLC.
4. Open a business bank account for the LLC.
5. Move the domain and vendor accounts (AWS, Hostinger, OpenRouter, Resend) to the LLC.
6. Get cyber liability and errors and omissions insurance quotes before charging anyone.
7. Then name the LLC as operator in the Terms and Privacy Policy and bump `TERMS_VERSION` and `PRIVACY_VERSION` in `src/lib/legal.ts`, ideally with the lawyer review (#22).

**Where.** `src/app/terms/page.tsx`, `src/app/privacy/page.tsx`, `docs/legal-review.md`.
