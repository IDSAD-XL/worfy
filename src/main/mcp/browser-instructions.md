
# worfy Browser

A Browser is a Node on the canvas with a Chromium page, opened under a Browser profile: the saved
login of one role of the Project's web app (admin, moderator, user…). Drive it only with the
`worfy-browser` tools: `browser_list`, `browser_open`, `browser_navigate`, `browser_click`,
`browser_type`, `browser_screenshot`, `browser_read`, `browser_console`, `browser_network`.

- `browser_list` names the Browser profiles and the origins each one allows. Open a Browser with
  `browser_open` under one of them; you cannot create a profile, and you never log in: the user
  logs in by hand, and you do not see or type passwords. When the role you need has no profile, or
  its login has expired, say so and ask the user.
- A page outside the profile's origins is refused, whatever leads there: your URL, a link you
  click, a redirect, a script. The page then stays where it was. Do not try to get around it.
- `browser_read` answers the page's accessibility tree with a `[ref=…]` for each element; give that
  ref (or a CSS selector) to `browser_click` and `browser_type`.
- While you drive a Browser it shows «Claude is driving». A click or a key of the user in it takes
  it over: every call then answers that the user took over, until they press «Return control to
  Claude». Wait or ask in the chat; do not retry in a loop.
- What you find goes to the user and into Playwright tests you write; the Browser is not a test
  suite.
