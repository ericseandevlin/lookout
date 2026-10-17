# Changelog

Every production release of Lookout, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Each version is also a git tag and a [GitHub Release](https://github.com/ericseandevlin/lookout/releases). Numbers in parentheses are GitHub issues.

## [Unreleased]

Work merged to `main` (staging) and waiting for the weekly release.

## [0.2.0] - 2026-10-17

### Added
- Pay listed at the bottom of a posting is found: Lookout reads the posting's structured salary, Greenhouse pay ranges and "$X - $Y" text on the full page, before trimming it for the model (#68).
- Postings that come down close themselves: each search re-checks open finds, and one confirmed gone on two searches at least 20 hours apart moves to Closed, is archived, and gets a dated note. Applied, Interview and Offer are never touched (#70).
- "Nope" stage, which also archives the find (#55).
- Admins can open a read-only view of a person's board, for testing during the beta. Each view is logged, and the privacy page says so (#47).

### Changed
- Previous and next buttons sit outside the drawer's left edge instead of in its header; arrow keys still work (#48).
- Row pin and archive icons stay quiet until hover and turn red when active, so the match score leads the row (#57, #72).

### Fixed
- The stage menu was cut off on short lists such as Archive (#56).

## [0.1.1] - 2026-10-15

### Fixed
- Notes count only when they're feedback about how Lookout reads you; other notes no longer go into searches (#49).
- Replies to Lookout emails reach a real inbox instead of disappearing (#64).

## [0.1.0] - 2026-10-14

First tagged release of the invite-only beta.

### Added
- Board, find drawer, profile, materials and settings; magic-link sign-in; invite-only access with requests and admin approval.
- Search pipeline on open models with a saved search profile ("What Lookout sees"), live progress and an after-search report with tips.
- Resume, LinkedIn PDF and links read into the profile; "Not a fit" reasons feed later searches.
- Email via Resend, nightly encrypted backups, privacy page.
- Notes save after a pause or when the drawer closes; the drawer slides in and out; previous and next between finds.

### Changed
- Auto-apply is staging-only behind `FEATURE_AUTO_APPLY`.

[Unreleased]: https://github.com/ericseandevlin/lookout/compare/v0.2.0...main
[0.2.0]: https://github.com/ericseandevlin/lookout/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ericseandevlin/lookout/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ericseandevlin/lookout/releases/tag/v0.1.0
