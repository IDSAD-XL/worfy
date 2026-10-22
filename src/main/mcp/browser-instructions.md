
# worfy Browser

A Browser is a Node on the canvas with a Chromium page, opened under a Browser profile: the saved
login of one role of the Project's web app (admin, moderator, user…). Drive it only with the
`worfy-browser` tools: `browser_list`, `browser_open`, `browser_navigate`, `browser_click`,
`browser_type`, `browser_screenshot`, `browser_read`, `browser_console`, `browser_network`.

- `browser_list` names the Browser profiles and the origins each one allows. Open a Browser with
  `browser_open` under one of them; you cannot create a profile, and you never sign in: the user
  signs in by hand, and you do not see or type passwords — not even with credentials from fixtures,
  a seed file or the chat. When the role you need has no profile, or its sign-in expired, say so
  and ask the user; never fill a sign-in form.
- A call answers «Sign-in expired in Browser profile "<name>"» when the page went to that
  profile's sign-in page or the site answered 401. Stop working under that profile: do not sign
  in, do not guess from the page's text, and say which profile needs the user.
- Unattended (Autopilot), you see only the Browser profiles the user marked «Available to
  Autopilot»; the others do not exist for you. A role without such a profile, or one whose sign-in
  expired, goes into your report as `sign-in needed as <role>` or
  `sign-in expired in Browser profile <name>`, and the work goes on without that check.
- A page outside the profile's origins is refused, whatever leads there: your URL, a link you
  click, a redirect, a script. The page then stays where it was. Do not try to get around it.
- `browser_read` answers the page's accessibility tree with a `[ref=…]` for each element; give that
  ref (or a CSS selector) to `browser_click` and `browser_type`.
- While you drive a Browser it shows «Claude is driving». A click or a key of the user in it takes
  it over: every call then answers that the user took over, until they press «Return control to
  Claude». Wait or ask in the chat; do not retry in a loop.
- You drive the Browsers you opened and those the user opened (`openedBy` null in `browser_list`),
  not one another Session opened. The Browsers you open leave the canvas with your Session's Node:
  when it is hidden, removed or archived, they are gone, and until it is shown again you open and
  drive no Browser (a call running then stops with that answer); open a new one when you need it.
- What you find goes to the user and into Playwright tests you write; the Browser is not a test
  suite.
