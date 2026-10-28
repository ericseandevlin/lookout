# Lookout Autofill (Firefox)

Fills an approved Lookout application on the job's own page in your Firefox. You check it and press the site's Submit button. When the thank-you page shows, the extension marks the application Submitted in Lookout and the find moves to Applied. Issue #169.

## Use

1. Lookout: Auto-apply, Settings, Firefox extension, then **Connect the extension**. Copy the token.
2. Install: click **Install the extension** in the same panel (serves `public/ext/lookout-autofill.xpi`).
3. Extension, then Settings: pick Production or Staging, paste the token, Save.
4. Open the job's apply page and click the extension, then **Fill this application**. Fix anything marked red, then press Submit.

## Develop

- Plain JavaScript, no build. `fill.js` mirrors `fillOne` in `src/lib/application/submit.ts`; keep them in step.
- Try it unsigned: `about:debugging`, This Firefox, Load Temporary Add-on, pick `manifest.json` (gone after a restart).
- Lint: `npx web-ext@8 lint -s extension/firefox`
- Sign (unlisted on AMO, so it survives restarts), with the key in `~/.config/lookout-ext/amo.env`:

```bash
set -a; . ~/.config/lookout-ext/amo.env; set +a
npx web-ext@8 sign -s extension/firefox --channel unlisted -a /tmp/lookout-ext
cp /tmp/lookout-ext/*.xpi public/ext/lookout-autofill.xpi
```

Bump `version` in `manifest.json` before each signing; AMO refuses a version it has already signed.
