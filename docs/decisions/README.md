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

## 7. AGPL-3.0 license (2026-11-08)

**Decision.** Lookout is open source under the GNU Affero General Public License v3.0, not MIT.

**Why.** Anyone can read, run and change it, which is the point of showing it. The Affero clause closes the hosting gap: someone who runs a changed Lookout as a service has to give its users the source. A hosted Lookout can't be cloned into a closed product.

**Cost.** Some companies won't touch AGPL code, so fewer people will reuse it at work. Outside contributions come in under AGPL too, so changing the license later means asking every contributor.

**Where.** `LICENSE`, `license` in `package.json`, the License section of the README, `CONTRIBUTING.md`.
