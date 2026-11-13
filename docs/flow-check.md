# Flow check

A weekly walk through the main flows in [flows.md](flows.md), in a real browser, that reports what a new person would trip on (#996). It reports only. It never fixes anything or opens issues by itself.

## What it walks

The `Flow check` workflow (`.github/workflows/flow-check.yml`) runs every Monday morning and on demand. Like the Screenshots workflow, it starts a fresh copy of Lookout on a GitHub runner from `main` (the code staging runs), seeds the made-up demo account, signs in as it and runs `scripts/flow-check.mjs`. No real server and no real data are involved.

| Flow in flows.md | Steps |
| --- | --- |
| 1. Getting in | Landing page, Request access (and sends it), Sign in (and sends a link), a group link that does not exist, Terms, Privacy, the sign-in link |
| 2. The search profile | Profile, What Lookout sees, Profile materials, Application answers |
| 4. Working the board | Board, one find opened |
| 5. Auto-apply | Auto-apply, Materials |
| Other | Settings, Activity, What's next |

Flow 3 (a search run) is not pressed: it needs an AI key and the search relay, and the throwaway copy has neither.

## What it reports

| Problem | How it is found |
| --- | --- |
| Page answers with an error | The page's HTTP status is 400 or more |
| Script error | An error in the browser console, or an uncaught exception |
| Failed request | A request to Lookout from the page fails or answers 400 or more |
| Broken link | Every link seen on the way is fetched once. Our own: any error. Other sites: 404, 410 or no answer |
| Step does not say what happens next | After sending a form, the page lacks the words that say what comes next (for example "inbox" after asking for a sign-in link) |
| Dead end | No link or enabled button in the page's main content |
| Control with no name, or a vague one | A button or link with no text, or one that says "Click here", "Submit", "More" and the like |
| No heading | No h1 or h2 in the main content |

The run's summary page shows `report.md`: one line per issue to open, highest severity first, with every step it showed on. The artifact `flow-check-<sha>` also holds `report.json` and, under `pages/`, the text and a full-page screenshot of every step.

## The AI read

The rules catch errors and missing words. Whether a step is clear needs a reader. Give an agent the artifact's `pages/` folder and this prompt:

> You are a new Lookout user who has never seen the app. For each step in `pages/`, in order, read the text and look at the screenshot. List every place where you would not know what to do next, what a button will do, or what just happened. Quote the words on the page. For each one, write a GitHub issue title (plain words, under 80 characters) and one sentence on what to change. Skip anything already in `report.md`. Do not list taste or styling.

## Running it by hand

```sh
# Signed-out pages of any Lookout, read only:
node scripts/flow-check.mjs --base https://staging.lookout.ericdevlin.co --out /tmp/flow-check
# Signed in too, with a link from scripts/login-link.mjs for an account past the welcome step:
node scripts/flow-check.mjs --base http://localhost:3000 --link "<sign-in link>" --submit
```

`--submit` sends the request-access and sign-in forms. Use it only on a throwaway copy: it adds a waitlist row. Chrome comes from `CHROME_PATH` or the installed "chrome" channel.
