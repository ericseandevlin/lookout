# Auto-apply (beta)

Opt-in, per user, off by default. Lives on its own page (`/apply`) with an on/off switch at the top. Modeled on Eric's Notion pipeline (`~/Life-OS/career-ops/pipeline-workflow.md`): nothing is ever submitted without the user's explicit approval of the exact versions that go out.

## The flow for one find

1. **Queue.** The user clicks "Apply with Lookout" on a find (or, with the switch on, Lookout queues finds scoring 4+ automatically; the user picks the threshold).
2. **Scan the application.** Lookout opens the posting and its apply page and lists everything the application asks for: contact fields, resume, cover letter, long-form questions and essays, portfolio uploads or links, work authorization and EEO questions, salary expectations, custom questions. It records which ATS runs it (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, other) and whether it can be submitted by API, by browser automation, or only by hand.
3. **Draft the packet.** For each item Lookout drafts a version:
   - **Resume, ATS-optimized:** the master resume reworded to carry the job description's keywords and must-haves, never inventing experience. Shows a keyword match score before and after, and which keywords were added where.
   - **Cover letter:** specific to the role and company, in the user's voice.
   - **Answers:** every long-form question and essay, plus short answers. Factual fields (authorization, location) come from the profile; anything unknown is flagged as a question for the user, never guessed.
   - **Portfolio:** which PDFs or links to show and why, from the user's materials.
   - **People to reach:** one or two people at the company the user might know or should know (recruiter, hiring manager, a teammate, a mutual connection), why each, and a proposed short personal message. Lookout only drafts these; the user sends them.
4. **Review, fully transparent.** A review screen shows every item side by side with the job description: what the application asks, what Lookout drafted, the sources it used, and what it changed from the master resume. The user can edit directly or **chat with the AI** to revise ("make the cover letter shorter", "lead with the Citi migration"). Every change saves a **version with a note** (who changed it, what and why). Unknowns are listed at the top as questions.
5. **Approve.** The user approves a specific version of each item. The packet is ready only when every required item has an approved version.
6. **Submit.** Lookout submits with the approved versions, by the best available route: ATS API where one exists for applicants, otherwise a browser worker (Playwright) that fills the form and uploads the files, stopping on captchas or anything unexpected. If automation isn't allowed or fails, it switches to **Manual submit**: a checklist with copy buttons and downloads so the user can finish in two minutes.
7. **Record.** Exactly what was sent (files, answers, timestamps, confirmation page or email) is stored with the find, and the find moves to Applied.

## Trust rules

- Never submit without approval of the exact versions. No silent edits after approval.
- Never invent experience, credentials, numbers or references. Unknowns become questions.
- Show sources for every claim in a draft.
- Respect sites that forbid automated submission (#29): those go to Manual submit.
- Outreach is drafted, never sent.
- Voluntary EEO questions (#122) are answered only from answers the person saved for them, only with the profile permission and the switch on that application (off by default), and any question can be skipped. Never sent to an AI, never in a resume, letter or message. Each fill and submission records the switch and what was shared from which saved answer (answers encrypted).

## Data

- `applications`: user, find, status (queued, scanning, drafting, needs_review, approved, submitting, submitted, manual, failed), ats, route, requirements (JSON), submitted_at, confirmation.
- `application_items`: application, kind (resume, cover_letter, answer, portfolio, outreach), prompt/question, required.
- `item_versions`: item, version number, content (text or file key), note, author (user or ai), created_at, approved_at.
- `application_messages`: the chat thread per application.
- `settings.auto_apply`: enabled, threshold, daily cap.

## Phases

1. Page, switch, data model, queue from a find.
2. Application scanner (ATS detection + requirements).
3. Drafting: ATS resume with keyword report, cover letter, answers, portfolio picks; versions with notes.
4. Review screen with chat-to-edit and approvals.
5. Submit: Manual submit checklist first, then browser worker for Greenhouse, Lever, Ashby.
6. People to reach + proposed messages.
