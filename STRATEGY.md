# Lookout strategy

What Lookout is for, who it serves, the bet it makes, and how we'll know if the bet is right. [ROADMAP.md](ROADMAP.md) has the full list of work; the Now / Next / Later view below groups it by the goal it moves. Short PRDs for the Next items are in [docs/prds.md](docs/prds.md).

Lines marked **Guess** are best guesses waiting for Eric to confirm or change.

## The problem

Job sites ask for a title and a city. That's all they know about you, so that's all they match on. The person looking does the rest: twenty tabs, the same posting on four boards, roles that say Director and mean something else. Searching is a part-time job, and most of it is reading things that were never a fit.

Volume doesn't fix it. In Huntr's Q1 2026 data, people who sent 100+ applications got an interview from 2.6% of them; people who sent 11 to 20 targeted ones got 9.3%. And referrals make up 30 to 50% of US hires (NY Fed and MIT). Fewer, better-matched applications plus the right people beat spraying.

## Who it's for

People with a specific next step in mind and a career that doesn't fit in a title field. Senior and mid-career people, career changers, anyone whose "what I'm great at" takes a paragraph.

It's also for people who aren't looking. Most people search every six months, feel behind, and give up. Lookout keeps looking when they don't, so good roles reach them first.

Right now that's a handful of friends in a private beta. After the January 10 gate, friends of friends through a waitlist: people with a job who would move for the right one.

## The bet

A search that knows you before it looks will find better matches than a search that only knows a title. And it can do that cheaply, on open models, if the work is split into small steps and the hard rules live in code.

Three parts to it:
- **Context in.** Five questions, a resume, a LinkedIn PDF and links. Lookout writes a search profile you can see and fix.
- **Judgment, not keywords.** It reads every posting in full and scores it 1 to 5 against you. A dealbreaker drops the role; under your floor or in the wrong place caps it at 3.
- **It learns from you.** "Not a fit" reasons and notes on finds go into the next search.

The same engine should work for any kind of find. Jobs are the first. RFPs are the test of whether that's true.

## Non-goals

- A job board. Lookout doesn't host postings or sell anything to employers.
- Mass applying. Auto-apply drafts, you review, you press Submit.
- Growth before quality. No marketing until the beta numbers say the finds are good.
- A business, yet. It's a side project. The beta decides whether it should become one.
- A find-anything tool. Jobs first, RFPs second. Furniture, roommates and the rest wait until two kinds work well.
- A personal CRM or an audience-building tool. Good ideas, different products.
- Feature sprawl. Every new feature has to serve one of two things: bringing opportunities to you, or applying for you in a way you trust.

## How we'll know

The beta runs through January 10, 2027. Goals, measured in Admin > Metrics (#36):

- 5 people active every week
- 1 or more finds acted on per active person per week
- At least 1 interview from a Lookout find
- Week-4 retention of 60% or better
- Under $1 per active person per month
- Zero data incidents

**January 10 gate.** If retention and action rate hit their goals, open a waitlist and start marketing. If they don't, fix finds quality first.

## What would change our mind

- People act on finds but don't come back: the digest and the schedule are the problem, not the matching.
- People come back but don't act: the scoring is off, or the profile is missing something the questions don't ask.
- Cost per person goes over $1 at five users: the cheap-model bet needs another look before more people join.
- People don't trust what auto-apply writes: they rewrite most drafts, or never press Submit. Trust is the product, so that would mean slowing down auto-apply and fixing the drafts first.
- **Guess:** stop building new features if, by January 10, fewer than 3 people are active weekly and nobody outside Eric has acted on a find in the last 4 weeks. Lookout then becomes a finished portfolio piece that Eric keeps running for his own search.

## Now / Next / Later

Each theme names the goal it moves.

### Now: prove the finds are good (action rate, retention)
- Paul and Jeff's two-week review (#81)
- Beta surveys and the metrics page (#5, #37, #36)
- Privacy and retention basics before more testers join (#24, #26)

### Next: make it worth coming back to (retention, cost)
- Auto-apply for testers beyond Eric, with every control visible (#6, needs #29)
- Events that work like Finds: networking is where referrals come from (#264, #265)
- A real test of the idea: ask everyone who contacts a tester how they found them, and run a small market test (issue to file)

### Later: more kinds, then tell people (after the January 10 gate)
- Kind picker and several searches per account, RFPs first (#8)
- Grants and fellowships, then speaking slots and calls for papers
- Rename before any marketing (#30), marketing pages and waitlist (#9), the blog post (#10)
- Terms, lawyer review, LLC and insurance before strangers pay (#20, #22, #23)

## Sources

- Huntr, job search trends Q1 2026: huntr.co/research/job-search-trends-q1-2026
- NY Fed and MIT referral study, as summarized by Glassdoor: glassdoor.com/blog/beyond-online-applications-job-search
