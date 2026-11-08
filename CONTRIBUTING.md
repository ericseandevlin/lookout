# Contributing to Lookout

Thanks for looking. Lookout is a small side project, so the process is light, but it is a process.

## Before you start

- Every change starts as a GitHub issue. If there isn't one, open one (bug or idea template) and say what you want to change and why.
- Issues labeled `good first issue` are a good way in. `agent-ok` means the fix is clear enough to just do.
- Security problems: don't open an issue. See [SECURITY.md](SECURITY.md).
- Lookout is licensed under [AGPL-3.0](LICENSE). By opening a PR you agree your change is released under the same license.

## Run it locally

The steps are in the README under [Local development](README.md#local-development): a Postgres container, `.env.local` from `deploy/env.example`, `npm install`, `npm run dev`. Sign-in links print to the dev server log when `EMAIL_DEV_LOG=1`. `npm run seed:demo` fills a made-up account with eight finds, so you can work on the board without an AI key; use it for screenshots too.

## Make the change

New to the code? [docs/architecture.md](docs/architecture.md) maps where things live and where to start for common changes.

- Branch from `main`: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/...` or `chore/...`.
- Put the issue number in every commit message, e.g. `Drawer: previous/next on the edge (#48)`.
- One branch per issue. Don't mix unrelated work.
- Run the hooks once per clone: `git config core.hooksPath .githooks`. They refuse commits on `main` or `prod` and commits with no issue number.
- Before you push: `npm run typecheck`, `npm run lint`, `npm test`. Add tests for logic you change.
- Schema changes: edit `src/lib/db/schema.ts`, then `npx drizzle-kit generate --name what_changed`.

## Open a pull request

- Into `main`, using the PR template. Say what changed for the person using Lookout, and how you checked it.
- CI runs typecheck, lint, tests, a dependency audit, Semgrep and a secret scan. Merge only when it's green. A PR that changes only Markdown or `docs/` (not README.md) skips CI, so there is nothing to wait for.
- PRs are squash-merged. `main` deploys to staging; `prod` moves only at the weekly release.

More detail on branches, releases and deploys is in the README under [How we work](README.md#how-we-work).

## Writing

User-facing copy is plain and short: no em dashes, no jargon, say what happened and what to do next.

## Conduct

Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md).
