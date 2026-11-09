# Speaking slots and calls for papers as a kind (#303)

A design note, not a plan of record. [STRATEGY.md](../STRATEGY.md) puts this kind in Later, after grants and after the January 10 gate. This note answers the open questions on #303 so the work is ready to pick up then. Lines marked **Guess** wait for Eric.

## Why it fits the engine

Conference CFPs, meetup speaker calls and podcast guest spots work like jobs: who you are decides what fits, they open all year, and each one has a deadline. The `rfp` kind already showed that a new kind is mostly a config in `src/lib/kinds/index.ts` plus a source.

## Profile (five questions, like the other kinds)

| Key | Kind | Prompt |
| --- | --- | --- |
| `q1` | text | What do you speak about, and what would make a slot a real step up? (append starters: bigger stage, keynote, new audience, first talk abroad) |
| `formats` | text | Which formats do you want? (toggle starters: Talk, Workshop, Panel, Lightning talk, Podcast guest) |
| `where` | modes | Where can you speak? Options: In person, Online. Area holds the travel range, e.g. "Northeast US, or anywhere if travel is covered" |
| `pay` | text | Paid only, or unpaid too? (toggle starters: Paid only, Travel covered, Unpaid is fine) |
| `q5` | text | What's off the table? (vendor pitch slots, pay-to-speak, weekends) |

**Guess:** reuse the `modes` question type for in person versus online, so no new question kind is needed. Pay stays text, not `comp`: most CFPs list "travel covered" or "honorarium", not a number.

## Stages

`Reviewing`, `Drafting`, `Submitted`, `Accepted`, `Declined`. Ended stages: `Declined`. Default: `Reviewing`.

**Guess:** add `Spoke` after `Accepted` so the board keeps a record of talks given, which is the proof people want. It would not be an ended stage.

## Board columns

| Slot | Key | Label |
| --- | --- | --- |
| columns | `company` | Event |
| columns | `role` | Format |
| columns | `location` | Where |
| preStage | `due` | CFP closes |
| tail | `value` | Pays |

All five keys already exist in `ColumnKey`, so no new column code. `due` holds the CFP close date and `value` holds "Travel + honorarium" style text.

## Sources

Checked November 9, 2026.

| Source | Public | Machine-readable | Useful fields | Notes |
| --- | --- | --- | --- | --- |
| confs.tech ([tech-conferences/conference-data](https://github.com/tech-conferences/conference-data)) | Yes | JSON files per topic and year, MIT license | name, url, dates, city, country, online, `cfpUrl`, `cfpEndDate` | CFP fields are optional (4 of 11 in the 2027 JavaScript file). Topic is the filename. Best first source. |
| developers.events ([scraly/developers-conferences-agenda](https://github.com/scraly/developers-conferences-agenda)) | Yes | `all-cfps.json` and `all-events.json` | CFP link, close date (ms), conference name, dates, "City (Country)" | No topic field in the CFP file. Messy dates and past years; filter by `untilDate`. |
| Calling All Papers | Yes | iCal at `api.callingallpapers.com/v1/cfp?type=calendar` | name, CFP URL, location, a date window | Gathers joind.in, confs.tech, PaperCall and Sessionize. No topics, placeholder dates and duplicates. |
| Sessionize | Event pages only | Per-event API set up by each organizer | n/a | No public list of open CFPs across events. Reading a CFP page found elsewhere is fine; robots.txt blocks only `/app/` and `/submission/helper/`. |
| PaperCall | Couldn't reach it | Unknown | n/a | DNS failed on two tries. Check again before relying on it. |
| CFP Land | No | No | n/a | Domain is for sale. |

All three readable sources lean toward tech conferences. For other fields (events, hospitality, design), the discovery agent's web search would have to carry it, the way it does for jobs. Podcast guest spots have no open feed; the matchmaking sites (PodMatch and the like) need an account, so podcasts would be web search only.

**Guess:** start with confs.tech and developers.events as fetched sources, merged and deduped by CFP URL, plus web search for meetups and podcasts. Skip anything whose close date has passed.

## Sharing work with Events

The Events list (`src/lib/networking.ts`, `src/lib/agent/networking.ts`) already finds talks and meetups to attend. The same conference often shows up in both: as an event to attend and as a CFP to answer.

- Keep them separate lists. Events are dated things to go to; CFPs are deadlines with a stage. Merging them would put stages on events, which have only pin and archive today (#265).
- Share the source fetchers. A confs.tech or developers.events reader can feed both: entries with an open CFP go to the CFP kind, entries with upcoming dates go to Events.
- Cross-link. When a CFP find and an event point at the same conference URL, the drawer for each can say so ("You're also tracking this as an event").

**Guess:** the source fetchers live in `src/lib/sources.ts` next to the SAM.gov reader, so both kinds call one place.

## Not in scope

- Submitting a CFP for the person. Lookout can draft an abstract later, the way auto-apply drafts a cover letter, but the person submits.
- Contacting organizers or podcast hosts.
- Pay-to-speak slots. Filter them out, or mark them down as a dealbreaker.
