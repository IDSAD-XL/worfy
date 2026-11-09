# Evidence

Three close Features. **Evidence** is a line under an item of a Ticket's done section that says what proved the item and
where it was checked; worfy shows the state of each item on the card and in Focus mode. The **privacy check** keeps
personal data out of what a branch adds to the Tickets root of a public repository. **Screenshots and clips** are the
pictures that can stand as Evidence: when an item needs one, and how a test of worfy takes it. Terms are explained in
[Concepts](concepts.md); the Ticket card and Focus mode are on [Workflow](workflow.md). The plan and the reasons are in the
spec of the Epic, [worfy-evidence](../../.scratch/worfy-evidence/spec.md).

## Evidence

### Behaviour

**The line.** An Evidence line is a nested list item under a checkbox item of the done section, one fact per line:

```markdown
- [x] Unit test of the chat command
  - evidence: test-run pass · `pnpm test test/unit/chat.test.ts` exit 0 · mac dev · 3f2a1b9c
  - evidence: review pass · PR #1190 · - - · 3f2a1b9c
- [ ] (manual) The canvas on the PC
  - needs: windows stable
  - evidence: screenshot pass · `../evidence/16-canvas.webp` · windows installed · bacbbcef · scrub: 2026-11-04
- [ ] (manual) A Ticket card dragged to another column follows the cursor and lands without a jump
  - evidence: video pass · `../evidence/11-card-drag.webm` · mac dev · 3f2a1b9c · scrub: 2026-11-05
```

The form is `- evidence: <kind> <verdict> · <ref> · <platform> <copy> · <sha>[ · scrub: <YYYY-MM-DD>]`, with the fields split
by ` · `:

| Field | Values |
|---|---|
| `kind` | `commit`, `test-run`, `ci-check`, `gate`, `review`, `screenshot`, `video`, `owner-check` |
| `verdict` | `pass` or `fail`, for every kind. A reviewer's `VERIFIED` is written `pass` and `REJECTED` `fail`; those two words are refused |
| `ref` | Free text on one line without ` · `: a command with its exit code, `PR #N`, a URL, or a path in backticks relative to the Ticket file |
| `platform` | `mac`, `windows`, `linux`, `ci`. A platform, never a host name |
| `copy` | The copy of the app that ran: `stable`, `installed`, `dev`, `ci`, or `-` when no app ran. `commit` and `review` always have `- -`; `screenshot`, `video` and `owner-check` must name a copy |
| `sha` | 7 to 40 hex digits: the commit the fact is bound to. Required |
| `scrub:` | The date a person checked the pixels of a screenshot, or every frame of a clip's contact sheet. Required on a `video` line, and on a `screenshot` line whose ref is a path |

`- needs: <platform> [<copy>]` is the item's requirement, written by the Ticket's author: the item is proved only on that
platform, and in that copy when one is named.

Every checkbox item of the section, at any depth, gets a number in file order from 1. An Evidence or needs line belongs to
the nearest checkbox item above it, and it does not join the item's text. Lines inside a code block are not read. The
section is the Profile's `tickets.done_section` (`## Done when` without a Profile) and the manual mark is
`tickets.manual_mark` (`manual`); the old Russian heading and mark are read too, for one release.

**The state of an item.**

| State | When |
|---|---|
| Failed | The last Evidence line of the item says `fail` |
| Verified | Not failed, every line reads, and a `pass` line of a proving kind matches `needs` by platform (and by copy, if `needs` names one). Every kind but `review` proves; a manual item is proved only by `owner-check`, `screenshot` or `video` |
| Not verified | Everything else, with the reason: `no evidence`, `review only`, `needs <platform> <copy>, got <platform> <copy>`, `manual item needs owner-check, screenshot or video`, `unreadable evidence line` |

The count `n of m` counts every checkbox item of the section: `m` includes the items without lines. An old Ticket without
lines reads `0 of m`, and nothing else changes for it.

**`ticket evidence`.** The Harness's `ticket` is the only writer of the lines:

- `ticket evidence <epic> <NN>` prints the items as `<n>. <state> <reason> — <text>`, each with its lines under it, and last
  `evidence: N of M verified`. Exit 0.
- `ticket evidence <epic> <NN> <item> <kind> <pass|fail> --ref "<text>" [--platform P] [--copy C] [--sha S] [--repo R]
  [--scrub YYYY-MM-DD] [-n]` writes one line after the last line of item `<item>`. The platform defaults to this system's
  (`ci` under GitHub Actions), the SHA to `HEAD`, the copy to `-`. On a ticket of several repositories `--repo R` (one of
  its `Repo:` lines) starts the ref with `[R] ` and takes the SHA from the HEAD of R's checkout. `-n` prints the line and writes nothing. The rest of the file,
  its byte order mark and its line ends included, stays as it was.
- Refused with exit 2, nothing written: a line the grammar refuses, an item outside the section, a flag without its value,
  a `screenshot` whose ref is a path and that has no `--scrub` ("check the pixels by eye first"), a `video` without
  `--scrub`, and a `video` whose ref is not a `.webm` or `.mp4` file in `<epic>/evidence/` of the Tickets root with a PNG
  contact sheet `<name>.sheet.png` next to it, or whose clip or sheet is a symbolic link. An unknown flag is exit 1.
- Refused with exit 1: the privacy check found something in a file a path in backticks of `--ref` leads to, or in the
  contact sheet of a clip. Its masked output goes to stderr. In Silent mode this check is skipped, since nothing there is
  published.

`ticket done` prints `evidence: N of M verified` and each unverified or failed item to stderr. Its exit code stays 0, and
the status is written.

**Who writes which line.** The skills and agent files of the Harness give each line its author. `ticket` itself does not
ask who runs it.

| Line | Who | When |
|---|---|---|
| `test-run`, `gate`, `commit` | The implementer | On its own branch, with the code, before the PR, so the lines are in the PR's diff and in the review. Only `pass`, and only for the items its checks proved |
| `review` | The Orchestrator | At the close: `pass` for `VERIFIED`, `fail` for `REJECTED`, ref `PR #N` |
| `ci-check` | The Orchestrator | At the close: the URL of the final CI check's run on the PR head, platform `ci` |
| `owner-check` | The Orchestrator, from the owner's word | Ref: the date and the owner's word; copy: the copy the owner looked at |
| `screenshot` | Whoever took it | After a person has checked its pixels: the date of that check goes into `scrub:` |
| `video` | Whoever recorded it | After every frame of its contact sheet has been checked. For a clip of the fixture build that check may be the agent's own, and the owner looks at such clips by sample; any other clip waits for a person |

A manual item gets no line from the implementer, except that `video` line of a clip of the fixture build. The reviewer
writes no line: it checks that each ref exists, that the SHA is on the branch and that `needs` matches.

`review` and `ci-check` are written at the close and not on the branch, because a line on the branch after CI would make a
new head and one more CI run. In Full mode the Orchestrator puts them into the state file of `land` as `prs[].evidence`, and
`land` writes them with `ticket evidence` in its documents PR before `ticket done`. In Silent mode there is no documents PR:
the Orchestrator runs `ticket evidence` itself in the Workflow folder, and `land` prints `evidence of #N is the
orchestrator's (tickets outside the repository)`.

**On the Canvas.** A Ticket card shows the chip `Evidence n/m`: green when every item is verified, red when an item failed,
neutral otherwise, with the three counts in its tooltip. In Focus mode the Evidence matrix above the Ticket's text shows a
row per item with its state and its lines, and each link opens its source: the SHA its commit and `PR #N` its pull request
on the page of the Project's `origin`, an `https://` URL as it is (an `http://` one stays plain text), a path in the system's default program. A Ticket without checkbox
items in its done section has neither. The chip opens nothing. The card, the chip's place and the matrix row by row are on
[Workflow](workflow.md#ticket-and-epic-on-the-canvas); screenshots and clips in the matrix are under
[Screenshots and clips](#screenshots-and-clips).

worfy does not check a line against its source. It does not ask whether a CI run is green, whether a SHA is an ancestor of
the merge or whether a gate verdict exists. A line is an honest record with a visible state.

### How it works

- **The line lives in the Ticket file.** The Ticket file is the source of truth, and worfy only reads it
  ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)). The lines are seen in the diff and in the review, and in
  Silent mode they live in the Workflow folder next to the Ticket.
- **A fact is bound to a commit.** The SHA is required, as for the marks of agents
  ([ADR-0067](../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)).
- **A platform, not a machine.** A host name in the line would itself be the leak the privacy check exists for.
- **Two copies of one grammar.** The Harness reads the lines in CommonJS and worfy in TypeScript. Both read the same shared
  cases, and a contract test holds them together, as it does for the Pipeline rules.

### Implementation

| What | Where |
|---|---|
| The grammar and the state rules, Harness copy | `harness/lib/evidence.cjs` |
| `ticket evidence`, the warning of `ticket done` | `harness/bin/ticket`; the description for people: `harness/bin/TICKETS.md`, "Evidence" |
| The lines of the close, `prs[].evidence` | `harness/bin/land` |
| Who writes which line | `harness/skills/ship-ticket/implementer-finish.md`, `harness/skills/ship-ticket/step-6-manual-gui-checks.md`, `harness/skills/ship-ticket/step-9-merge.md`, `harness/skills/epic-wave/SKILL.md`, `harness/agents/reviewer.md` |
| The grammar and the state rules, worfy copy; the model | `src/shared/workflow/evidence.ts`, `src/shared/workflow/types.ts` |
| Reading the items with the Ticket | `src/main/workflow/reader.ts` |
| The chip and the matrix | `src/renderer/canvas/badges/Evidence.tsx`, `src/renderer/canvas/nodes/EvidenceMatrix.tsx` |

**Data flow.** The reader parses the done section of each Ticket file with `evidenceItems` and sends the items with their
states in the Ticket model. The chip counts them with `evidenceSummary`, and the matrix draws them. worfy never writes a
line.

**Main tests.**

- `harness/bin/tests/ticket-evidence.test.sh`: the matrix, writing a line, every refusal, the states, `ticket done`, the
  headings.
- `harness/bin/tests/land.test.sh`: the lines of `prs[].evidence` and the check before push.
- `harness/bin/tests/agents-text.test.sh`: the agent and skill texts keep the rules of who writes which line.
- `test/unit/evidence.test.ts` and `test/contract/evidence-rules-agree.test.ts`, the latter on the shared cases
  `harness/bin/tests/fixtures/evidence/grammar.json`: worfy's copy, and that it agrees with the Harness's.
- `test/unit/evidence-matrix.test.tsx`, `test/e2e/ticket-evidence.spec.ts`: the chip, the matrix and where its links lead.

## Privacy check

### Behaviour

`evidence-check` of the Harness looks for personal data in what a branch adds to the Tickets root (`.scratch/` in worfy:
Tickets, `spec.md`, the `evidence/` folders). It does not stop a push by itself: it runs at these places, and each one
stops on a finding.

| Where | What it does on a finding |
|---|---|
| `ticket evidence` | Checks the file of the ref before it writes the line; refuses with exit 1 |
| `land` | Checks its documents PR before the push; commits and pushes nothing, the result is red |
| The skills `ship-ticket` and `epic-wave` | Before the push of a documents PR made by hand: `evidence-check --changed` must exit 0 |
| `pnpm lint` | Ends with `evidence-check --changed --root .scratch`. CI runs it in the job `lint-typecheck` on every PR, a documents-only one too. This is the last line: a red `ci-ok` blocks the merge, but the push has already happened |

**What it reads.** With `--changed`: the files of the Tickets root that the branch added or modified, staged or not, and
the untracked ones. Of a modified text file only its added lines are read; an added file is read whole, and its path too: a
screenshot whose file name holds a host name is a leak as well. Files named on the command line are read whole. The base
is `--base`; under GitHub Actions `HEAD^1`; otherwise `git merge-base HEAD <worktree.base>` of the Profile (`origin/main`).
Old files are not checked: only what the branch adds.

**What it finds.**

| Rule | What | Not a finding |
|---|---|---|
| `home-path` | The user name in a home folder path: `/Users/<name>/`, `/home/<name>/`, `C:\Users\<name>\` (any number of `\`, or `/`), the same path as Git Bash (`/c/…`) and WSL (`/mnt/c/…`) write it | The names `test`, `someone`, `user`, `you`, `runner`, `runneradmin`, `RUNNER~1`, `Shared`; any `<…>`; an ellipsis; a variable (`$USER`, `%USERNAME%`); a name that starts with a dot (`/home/.cache`); `~` and `%USERPROFILE%` |
| `host` | A name ending in `.local` (in lower case only) or `.ts.net` (Tailscale MagicDNS, in any case), `DESKTOP-` and seven letters or digits, names with `-MacBook`, `s-Mac` or ending in `-PC`, and the short host name of the machine that runs the check | `localhost`; a host with an `example` label |
| `tailscale-ip` | An IPv4 address of the Tailscale network, 100.64.0.0/10 | That network written as CIDR |
| `uuid` | A UUID of any version | A UUID of one repeated digit, `00000000-0000-0000-0000-000000000000`, and one whose digits but the version and variant digits are one repeated digit, `44444444-4444-4444-8444-444444444444` |
| `email` | An email address | `noreply@…`, `no-reply@…`, addresses at `users.noreply.github.com`, `git@github.com`, any address at `example.*`, a file name with `@` |
| `token` | GitHub tokens, `sk-` keys that hold a digit (Anthropic ones too; without a digit it is read as a name such as a branch `sk-learn-…`), AWS access keys, Slack tokens, a JWT, the first line of a PEM private key, the value after `Bearer` | |
| `deny` | A word of the personal list `<Harness home>/user/privacy.json`, `{"deny": ["…"]}`, anywhere, in any case | |

There is no allow list in the repository: a false finding is fixed by writing the value in a stand-in form (`~`,
`<home>`, `<host>`, `<uuid>`), so that no allow list publishes the value. The personal list lives outside every repository
and holds the names the patterns cannot know, such as the other machine of the owner.

**Images and other binary files.** Of a screenshot (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`) the check reads the text of
its metadata: PNG `tEXt`, `iTXt`, `zTXt` and `eXIf`, JPEG Exif, XMP and comments, WebP `EXIF` and `XMP `, GIF comments. It
does not read pixels. A screenshot or other binary file the branch adds needs a `screenshot` line with `scrub:`, also added
by the branch, whose path in backticks leads to that very file from the Ticket's folder; a file of the same name in another
Epic does not count. Without it the finding is `image needs a human check (no scrub: note)`. A modified or old image gives
no such finding.

**Clips** (`.webm`, `.mp4`, and `.mov`, `.m4v`, `.mkv`, read as clips so that no `screenshot` line marks them). The check
reads every element and box of the container but the frames, in UTF-8 and UTF-16, and the neighbouring ones joined, so
that a path split between two of them is found. A clip is a finding when it has a track of sound (a test records none, so
sound can only be the machine's microphone), a track of subtitles or data, metadata compressed inside it, more than 8 MB
(8 × 1024 × 1024 bytes), more than 60 s, no duration in its header, or a container that does not read to its end. A clip
the branch adds needs a `video` line with `scrub:` (a `screenshot` line does not mark it): `video needs a human check (no
scrub: note)`. It also needs its contact sheet `<name>.sheet.png`, a PNG added by the same branch: `video needs a contact
sheet`. The clip's line covers its sheet, and the sheet's metadata is checked as an image's. A symbolic link is checked as
its text, the way git publishes it; one that points outside the repository is a finding.

**Output.** One line per finding, `<file>:<line>: <rule>: <masked value>`. The value shows only its first two characters,
`…` and its length (`Ab…(6)`), because a CI log is public. A finding in a file's path is masked in the path too. For an
image `<line>` is the metadata chunk, for a clip the element or box, for a file path `path`, and `-` for the whole file.
Exit 0 prints `evidence-check: ok (N files)`, 1 means findings and ends with `evidence-check: N findings`, 2 means the
check could not run (no git, no base). In Silent mode the Tickets root is outside the repository: the check prints
`nothing to check` and exits 0.

**How to fix a finding.** Replace the value by its stand-in form: `~` or `<home>` for a home folder, `<host>` for a
machine, `<uuid>` for a UUID. For a new screenshot or clip, a person checks it and the line gets its `scrub:` date. Do not
push until the check exits 0.

#### What it cannot catch

`evidence-check --help` lists the first six items. The page adds what the code also misses: a `.local` name in upper case,
XML entities and percent-encoding, a path split in UTF-16, a bare zlib stream, and the last item.

- Text on the pixels of a screenshot or a clip: Machine names in the sidebar, a Project title, terminal output in the
  picture. Only a person and the `scrub:` note catch them.
- The frames of a clip between the seconds of its contact sheet: what showed for less than a second may be on no frame of
  the sheet. That is why an agent may check only clips of the fixture build, which holds no data of the machine.
- A host or user name in an unpredictable form, such as a short form or another spelling, that is not in the personal list.
  A `.local` name in upper case (`BOX.LOCAL`) is such a form: that rule is case-sensitive.
- The name of the other machine (the PC on the Mac and back) until it is in the personal list: the host name is known only
  for the machine the check runs on, and on CI for none.
- A secret broken by a line break, base64, and other encodings than UTF-8 and UTF-16. Among them: a path written with XML
  entities (`&#47;` for `/`) or percent-encoding (`%2F`), which the rules do not decode; a path split between two
  elements of a clip in UTF-16 (only the UTF-8 readings are joined); and metadata compressed inside a clip as a bare zlib
  stream, which is neither unpacked nor reported (only a webm `ContentCompression` element, QuickTime `cmov` and the bytes of gzip, zip, xz, zstd, 7z and bzip2 are found).
- Files outside the Tickets root, the git history (what is pushed stays reachable by its SHA), the text of PRs and
  comments on GitHub.
- On a push to `main` or a run by hand, the CI job checks only the last commit (`HEAD^1..HEAD`): the earlier commits of a
  push of several are not checked there. Each change's PR was checked against its own base before the merge.

#### Windows

The check is a Node script without dependencies and runs on Windows. Paths are compared case-insensitively there.

### How it works

- **Only what the branch adds.** Old Ticket files already hold home folder paths; checking the whole tree would drown in
  them, so the check reads added lines and new files only.
- **The rules are one module apart from the script.** `privacy.cjs` holds the patterns, the stand-ins and the mask and
  reads no files but the personal list, so another script can take the same rules without the reading of git.
- **The note is parsed by one expression of its own**, not by the Evidence parser of the Harness. A line inside a code block
  counts as a note too.

### Implementation

| What | Where |
|---|---|
| The rules, the mask, the personal list | `harness/lib/privacy.cjs` |
| The check: files, metadata, clips, notes, output | `harness/bin/evidence-check` |
| In `pnpm lint` | `package.json`, script `lint` |
| In CI, with two commits checked out | `.github/workflows/ci.yml`, job `lint-typecheck` |
| Before the push of `land` | `harness/bin/land` |
| Before a push by hand | `harness/skills/ship-ticket/step-11-close.md`, `harness/skills/epic-wave/SKILL.md` |

**Main tests.**

- `harness/bin/tests/evidence-check.test.sh`: every rule and stand-in, the metadata of images and clips, the notes,
  `--changed` in a temporary repository, the masked output. Its values are put together from pieces in the test, so the
  repository passes its own check.
- `harness/bin/tests/ticket-evidence.test.sh`: the refusals of `ticket evidence` on a finding.
- `test/contract/ci-workflow.test.ts`: the two commits of the job `lint-typecheck`.

## Screenshots and clips

### Behaviour

**When an item needs a picture.** By what the item says:

- It is about **how something looks**: layout, colour, a label, the state of a control, a theme. A screenshot of the
  app's window in both themes, kind `screenshot`.
- It is about **motion**: an animation, a drag, a sequence over several screens, timing. A clip with its contact sheet,
  kind `video`.
- **Anything else** gets no picture: a test with its exit code proves it. A picture "just in case" is one more file whose
  pixels someone must check by hand.

A picture comes only from a build of worfy itself with fixture data (a temporary Project, a fake agent, no data of the
machine), taken by Playwright through the e2e tests; never from an installed copy or the Stable copy, and never by a
capture of the screen through the OS.

**The clip and its contact sheet.** A clip is `.scratch/<epic>/evidence/<NN>-<what>.webm`: VP8 as Playwright records it, no
longer than 60 s, no bigger than 8 MB, without sound. Next to it lies `<NN>-<what>.sheet.png`: one PNG, a grid of frames, a
frame for every second of the scenario with the second under it, each frame at the window's own size. The sheet is what is
checked by eye before `scrub:`; the clip is watched when the sheet raises a question. The clip also holds the app's start
and quit, a few seconds more than the scenario; the sheet does not.

**In the matrix.** Under a `screenshot` line whose file lies in `<epic>/evidence/` (`.png`, `.jpg`, `.jpeg`, `.gif`,
`.webp`) the matrix shows a thumbnail; a click opens the image over the window, with "Open in default app". Under a
`video` line the clip (`.webm` or `.mp4`) plays in place, muted, with its controls, and "Contact sheet" opens the sheet
over the window. A file that does not load says "File not found", "File over 8 MB" or "File cannot be shown" (served, but
not a picture or a clip the window draws), next to "Open in default app"; a contact sheet that does not load closes the
overlay and says so next to the clip.

#### On a Linked machine

A window on a Linked machine shows no thumbnail and plays no clip: the store of Evidence files is not served over the link,
and a path in the matrix shows "File is on <Machine>", as the Ticket's other links do.

#### Windows

The helpers record on Windows too. The contact sheet is drawn on a canvas in a hidden window, because a window there,
even off screen, is cut to the size of the screen.

### How it works

- **The sheet is taken, not decoded.** The helper takes a screenshot every second while the scenario runs, instead of
  taking frames out of the clip: the Harness then needs no video decoder and no new dependency. The cost is the frames
  between the seconds, which the privacy check names as a limit.
- **Files come through `worfy-image://`.** The store of a Project's Evidence files is named `evidence-<project label>` (the
  project label is 8 hex digits). Its root is the Project's Tickets root, the Workflow folder's in Silent mode, and it
  serves only files under `<epic>/evidence/`, up to 8 MB, images and clips. The name has a hyphen and not a dot because
  Chromium reads a host whose last part is all digits as an IPv4 address and refuses the URL, and a project label is all
  digits now and then. For the same reason a Canvas image's host is spelled `canvas-<project label>`
  ([Canvas](canvas.md)).
- **A clip is served in ranges.** The store answers a `Range` request with 206 and `Content-Range`, so a `<video>` can
  seek; a range past the end is a 416, a file over 8 MB a 413. The file is opened once and its descriptor checked against
  the path, so a file swapped after the check is a 404. No symbolic link is followed on any step. The window's security
  policy opens `media-src` to this scheme only.
- **A tracked file is not replaced.** A rerun of a helper with the same Ticket refuses a file git already tracks: a checked
  picture must not change unseen.

### Implementation

The helpers are for developers of worfy. `captureScreenshot(page or locator, what)` takes `<NN>-<what>-light.png` and
`<NN>-<what>-dark.png` and puts the page's colour scheme back afterwards. `recordClip(what, scenario)` starts the fixture
build with `recordVideo`, refuses an `executablePath`, runs the scenario with a frame every second and keeps the clip and
its sheet. Both write into `.scratch/<epic>/evidence/` of the worktree when `WORFY_EVIDENCE=<epic>/<NN>` is set, and into
the test's own output folder otherwise, so a run on CI leaves nothing in the repository. Each file passes `evidence-check`
before the helper returns, and on any error no file it wrote is kept. For a Ticket the helper prints the `ticket evidence`
command, with the item number and the `scrub:` date left for whoever checks the pixels. `pnpm test:e2e` installs
Playwright's ffmpeg first, which a clip needs, and `recordClip` names the install command when it is missing. The app under
test gets `WORFY_TAILSCALE` pointing at a missing file, so no tailnet names of the developer's machine reach a picture.
They live in `test/e2e/evidence-capture.ts`.

| What | Where |
|---|---|
| The capture helpers | `test/e2e/evidence-capture.ts`; `recordVideo` of `launchApp` in `test/e2e/helpers.ts`; the environment of the app under test in `test/e2e/launch-env.ts` |
| The rule "when a picture" | `harness/skills/ship-ticket/step-6-manual-gui-checks.md`, `harness/skills/ship-ticket/implementer-finish.md` |
| The store name, the address, the 8 MB limit | `src/shared/images.ts` |
| The Evidence store, only for this Machine's window | `src/main/images/stores.ts` |
| Serving files, ranges, the limits | `src/main/images/protocol.ts` |
| The window's security policy | `src/renderer/index.html` |
| The preview in the matrix | `src/renderer/canvas/nodes/EvidencePreview.tsx`, `src/renderer/canvas/nodes/evidence-files.ts` |

**Main tests.**

- `test/e2e/evidence-capture.spec.ts`: a screenshot in both themes and a clip with its sheet on a real Playwright
  recording, both through `evidence-check`.
- `test/contract/evidence-image-protocol.test.ts`: the store, the paths it serves and refuses, ranges, 413 and 416.
- `test/e2e/ticket-evidence.spec.ts` on the fixture clip `test/fixtures/evidence-clip/`: the thumbnail, the overlay, the
  clip playing and the contact sheet in the window.
- `test/unit/evidence-matrix.test.tsx`: which lines get a preview, and the failure labels.
