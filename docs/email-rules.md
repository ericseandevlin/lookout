# Email rules (#28)

What every email Lookout sends has to do, so it stays within CAN-SPAM. Agents wrote this; it is not legal advice.

## Which rules apply

| Email | Kind | Needs unsubscribe and address? |
| --- | --- | --- |
| Sign-in link, email change confirmation | Transactional | No |
| Invite (someone asked, or an admin invited them) | Transactional | No |
| Finds email (digest) | Service the person turned on | Yes, by choice: unsubscribe link, one-click headers, address when set |
| News, launch notes, waitlist updates, anything that promotes Lookout | Commercial | Yes, always |

If an email mixes both, treat it as commercial.

## How the code enforces it

- **Send news and waitlist mail only through `sendNewsMail` in `src/lib/bulkMail.ts`.** It refuses to send when `MAIL_POSTAL_ADDRESS` is empty, skips anyone on the opt-out list, and adds the footer and the `List-Unsubscribe` and `List-Unsubscribe-Post` headers (RFC 8058, which Gmail and Yahoo also require of bulk senders). Never call `sendMail` directly for these.
- **Unsubscribe links** are signed with `APP_SECRET` and never expire. `/unsubscribe?t=…` shows one button, no sign-in. Mail apps post to `/api/unsubscribe?t=…` for one-click unsubscribe. A plain GET changes nothing, so link scanners can't unsubscribe anyone.
- **Opt-outs take effect at once**, inside the 10 business days the law allows. News opt-outs go in `email_opt_outs`, which is not tied to an account, so it survives account deletion and a later sign-up. Unsubscribing from the finds email turns it off in that person's settings; they can turn it back on there.
- **Consent records.** The request-access form shows `WAITLIST_NOTICE` (`src/lib/legal.ts`). Each `access_requests` row stores `consent_version` and `consent_at`. When the notice wording changes, bump `WAITLIST_NOTICE_VERSION`.

## Writing a commercial email

- The From name and Reply-To are real (`MAIL_FROM`, `MAIL_REPLY_TO`). Replies reach a person.
- The subject says what the email is. No fake "Re:" or "Fwd:".
- Say plainly that it's news about Lookout if that isn't obvious.
- Don't sell, share or hand the list to anyone. Don't email an address after it opted out, even from another tool. If news ever goes out through another service (a newsletter tool), load `email_opt_outs` into its suppression list first.
- Don't buy lists or add addresses people didn't give Lookout themselves.

## Not built yet

- A way to subscribe again after unsubscribing from news. Today it means deleting the row by hand, only when the person asks in writing.
- The postal address itself. `MAIL_POSTAL_ADDRESS` is empty until Eric picks one (a PO box or mailbox service is the usual choice for a one-person project).
