# How Lookout works: the flows

Every main flow as a diagram, for someone who has not read the code. For where the code lives, see [architecture.md](architecture.md).

Each box has one of three colors:

- **Blue: a person does it.** The app waits here.
- **Orange: an AI model does it.** Each of these is one request to the model, and each has a step name. The same names show in the AI request log (#985).
- **Grey: plain code does it.** No model, no person.

## 1. Getting in

Three doors lead to the same sign-in link. Lookout has no passwords.

```mermaid
flowchart TD
  A[Asks for access on the landing page]:::person --> B[Request is saved on the waitlist]:::code
  B --> C[Admin sends an invite]:::person
  D[Opens a group link, /join/code]:::person --> E{Link open and seats left?}:::code
  E -- no --> F[Page says the link is closed or full]:::code
  E -- yes --> G[Types an email, takes one seat]:::person
  C --> H[Email with a sign-in link]:::code
  G --> H
  I[Already has an account, types email at /signin]:::person --> H
  H --> J[Clicks the link]:::person
  J --> K{Agreed to current Terms and Privacy?}:::code
  K -- no --> L[Ticks the agreement box]:::person
  L --> M
  K -- yes --> M{Finished the welcome step?}:::code
  M -- no --> N[Welcome: picks what to search for, answers the first questions]:::person
  N --> O[Board]:::code
  M -- yes --> O
  classDef person fill:#dbeafe,stroke:#1d4ed8,color:#0b1b3f
  classDef ai fill:#ffedd5,stroke:#c2410c,color:#431407
  classDef code fill:#f1f5f9,stroke:#64748b,color:#0f172a
```

## 2. The search profile

Lookout does not search with the raw resume. It builds one short picture of the person and searches with that. The person can read it on Profile, under "What Lookout sees".

```mermaid
flowchart TD
  A[Answers the profile questions]:::person --> E
  B[Uploads a resume]:::person --> B2[Model reads the resume into fields: step resume]:::ai --> E
  C[Uploads the LinkedIn PDF, adds links]:::person --> C2[Code reads the text of the PDF and the links]:::code --> E
  D[Writes notes on finds]:::person --> E
  E{Did any input change since the last build?}:::code
  E -- no --> F[Keep the stored profile]:::code
  E -- yes --> G[Model writes the search profile: step search_profile]:::ai
  G --> H[Profile is stored and shown on the Profile page]:::code
  H --> I[Person reads it, fixes an answer or adds a note]:::person
  I --> E
  classDef person fill:#dbeafe,stroke:#1d4ed8,color:#0b1b3f
  classDef ai fill:#ffedd5,stroke:#c2410c,color:#431407
  classDef code fill:#f1f5f9,stroke:#64748b,color:#0f172a
```

Notes are the feedback loop. Most notes are private jottings. The model keeps only the ones that say something about what Lookout found, for example "too junior" or "I do not want agencies".

## 3. One search run

A run starts on the person's schedule (the scheduler checks every 10 minutes) or when the person presses Search now. Searches run one at a time.

```mermaid
flowchart TD
  A[Schedule is due]:::code --> C
  B[Presses Search now]:::person --> C
  C{Under the daily spend caps?}:::code
  C -- no --> C2[Run stops. No search today]:::code
  C -- yes --> D[Load the profile, rebuild it if inputs changed]:::code
  D --> E[Model writes 4 to 6 web searches: step queries]:::ai
  E --> F[Code runs each search on the search relay, drops links already on the board]:::code
  F --> G[Model picks the results that look like one real posting: step picks]:::ai
  G --> H[Code opens each page and reads the text and the pay]:::code
  H --> I[Model scores each posting against the profile: step score]:::ai
  I --> J[Hard rules: pay floor, dealbreakers, closed postings]:::code
  J --> K[New finds are saved to the board]:::code
  K --> L{Auto-apply on, and score at or above the person's bar?}:::code
  L -- yes --> M[Find is queued for auto-apply, see flow 5]:::code
  L -- no --> N
  M --> N[Code checks that older open finds are still posted, closes the gone ones]:::code
  N --> O[Run report: the searches, how many read, why postings were kept off]:::code
  O --> P{Scheduled run, and finds email on?}:::code
  P -- yes --> Q[Finds email goes out]:::code
  P -- no --> R[Done]:::code
  classDef person fill:#dbeafe,stroke:#1d4ed8,color:#0b1b3f
  classDef ai fill:#ffedd5,stroke:#c2410c,color:#431407
  classDef code fill:#f1f5f9,stroke:#64748b,color:#0f172a
```

Where it searches: the open web, through a self-hosted search relay (SearXNG). Some queries aim at employer pages on Greenhouse, Lever, Workday and Ashby. Listing pages from Indeed, LinkedIn, Glassdoor and ZipRecruiter are skipped, because they are lists, not postings.

## 4. Working the board

Nothing here uses a model. This flow is the one the main metric counts: people who act on a find each week.

```mermaid
flowchart TD
  A[Finds email arrives]:::code --> B[Clicks a find in the email]:::person
  B --> C[Click is counted, board opens on that find]:::code
  D[Opens the board]:::person --> E
  C --> E[Reads the score, the match reasons and what to look out for]:::person
  E --> F{What does the person do?}:::person
  F --> G[Opens the posting link]:::person
  F --> H[Pins it or moves it to Applied or later]:::person
  F --> I[Writes a note]:::person
  F --> J[Archives it]:::person
  F --> K[Presses Apply with Lookout, see flow 5]:::person
  G --> L[Counted as acted on]:::code
  H --> L
  I --> M[Note feeds the next profile build, see flow 2]:::code
  classDef person fill:#dbeafe,stroke:#1d4ed8,color:#0b1b3f
  classDef ai fill:#ffedd5,stroke:#c2410c,color:#431407
  classDef code fill:#f1f5f9,stroke:#64748b,color:#0f172a
```

## 5. Auto-apply (beta, admins only on production)

The rule that holds this flow together: nothing is sent until the person approves the exact version of every required item.

```mermaid
flowchart TD
  A[Presses Apply with Lookout, or the find was queued by a search]:::person --> B[Status: queued]:::code
  B --> C[Code opens the posting and its application form]:::code
  C --> D[Model lists what the form asks for: step apply-scan]:::ai
  D --> E[Code adds the basic fields and notes which site runs the form]:::code
  E --> F[Model plans keywords: step apply-keywords]:::ai
  F --> G[Model drafts the resume: step apply-resume]:::ai
  G --> H[Model drafts the cover letter: step apply-letter]:::ai
  H --> I[Model drafts the answers: step apply-answers]:::ai
  I --> J[Model suggests people to reach: step apply-outreach]:::ai
  J --> K[Code checks drafts: no new numbers, no swapped roles. EEO answers never go to a model]:::code
  K --> L[Status: needs review]:::code
  L --> M[Person reads each item beside the posting]:::person
  M --> N{Happy with it?}:::person
  N -- edits by hand --> M
  N -- asks for a change --> O[Model revises the item: step apply-revise]:::ai --> M
  N -- wants a critique --> P[Model reads it as a recruiter: step apply-recruiter]:::ai --> M
  N -- has unanswered questions --> Q[Person answers. The answer is saved for later applications]:::person --> M
  N -- yes --> R[Approves each required item]:::person
  R --> S{Who presses Submit?}:::code
  S -- Greenhouse, Lever or Ashby, and Submit for me is on --> T[Lookout fills the form and submits]:::code
  S -- any other site, or the switch is off --> U[Browser extension fills the form. Person presses Submit]:::person
  T -- CAPTCHA or a field it cannot fill --> V[Nothing is sent. Manual checklist with copy buttons]:::person
  T --> W[Status: submitted. The find moves to Applied]:::code
  U --> W
  V --> W
  classDef person fill:#dbeafe,stroke:#1d4ed8,color:#0b1b3f
  classDef ai fill:#ffedd5,stroke:#c2410c,color:#431407
  classDef code fill:#f1f5f9,stroke:#64748b,color:#0f172a
```

On production today: auto-apply is on for admins only, and Submit for me is off. So every application ends with the person pressing Submit.

## Every AI step

These are all the places a model is asked something. Everything else is code.

| Step name | Flow | What the model is asked | What checks its answer |
| --- | --- | --- | --- |
| `resume` | Profile | Read an uploaded resume into fields | The person sees and edits the fields |
| `search_profile` | Profile | Write the short picture of the person | Shown on Profile, the person corrects it |
| `queries` | Search | Write 4 to 6 web searches | If none come back, the target titles are searched |
| `picks` | Search | Pick results that look like one real posting | Code reads each page and drops lists and closed postings |
| `score` | Search | Score each posting against the profile | Hard rules for pay floor and dealbreakers |
| `apply-scan` | Auto-apply | List what the application form asks for | Code adds basic fields, the person reviews |
| `apply-keywords` | Auto-apply | Plan which posting keywords the resume can truthfully carry | The person sees the keyword pills on the review page |
| `apply-resume` | Auto-apply | Draft the resume for this posting | Code flags new numbers and swapped roles |
| `apply-letter` | Auto-apply | Draft the cover letter | Same checks, then the person |
| `apply-answers` | Auto-apply | Draft answers to the form's questions | Unknowns become questions for the person |
| `apply-outreach` | Auto-apply | Suggest people to contact and a message | Drafts only. Lookout never sends them |
| `apply-revise` | Auto-apply | Change one item as the person asked | Saved as a new version with a note |
| `apply-recruiter` | Auto-apply | Critique an item as a recruiter | Shown as advice, changes nothing |
| `master-resume` | Auto-apply | Build one master resume from the person's materials | Date and role checks |
| `events`, `score_rfps` | Switched off | Networking events and RFP searches | Off on production |

## Where the app waits for a person

1. The sign-in link in the email.
2. The agreement box, when Terms or Privacy changed.
3. The welcome step.
4. Search frequency and the finds email, in Settings. Nothing prompts for these; the defaults apply until the person changes them.
5. Review and approval of every auto-apply item.
6. Unanswered application questions.
7. The final Submit, on every site where Lookout does not submit by itself.

## What can stop a run

- A spend cap: per person per day, or for everyone per day.
- The search relay returns nothing, when the search engines block it.
- No AI model is set in Admin.
- The model returns an answer that is not valid. Code asks again, up to 3 times, then fails the step.
