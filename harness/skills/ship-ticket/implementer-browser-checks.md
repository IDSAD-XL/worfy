# implementer: Browser checks

**Browser checks** (a session in worfy with the `worfy-browser` MCP tools: `browser_list`,
`browser_open`, …). Acceptance criteria that a person would check in the project's web pages are
checked in a Browser, once under each role of the brief's line `Browser roles` (no line — `Default`).
A role is the name of a Browser profile, as `browser_list` lists it; never guess a role from the
ticket's list of what "done" means. Open each Browser with `browser_open` and `ticket` set to your
ticket as `<epic>/<NN>` (from the brief's `Ticket:` line): the Browser then joins that ticket's
Family, and in Autopilot `browser_open` refuses a call without it. A Browser profile holds a sign-in the user made by hand: never
sign in yourself and never type a password, not even one from a fixture, a seed file or the chat.
- A role with no profile of that name in `browser_list` (in Autopilot the list holds only the
  profiles marked "Available to Autopilot") goes into `sign_in_needed` as
  `sign-in needed as <role>`.
- A call that answers `Sign-in expired in Browser profile "<name>"` (the page went to the profile's
  sign-in page, or the site answered 401) ends the checks under that profile; it goes into
  `sign_in_needed` as `sign-in expired in Browser profile <name>`. No other signal counts: do not
  judge the sign-in by the page's text.
- Either way the work goes on without that check; it is not a red step 5.
- What a check finds is a problem with a Playwright test for it in the project's e2e suite — red
  first, then fixed — not a Browser run in CI. Without the `worfy-browser` tools these criteria go
  into `not_verified`.
