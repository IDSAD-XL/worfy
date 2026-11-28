# Code story — worfy-harness-guarantees 04: `land`: пути проверок, draft, `land --check`

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

`land` сливал PR по зелёному CI и отметкам и не смотрел, какие файлы PR правит: PR мог сделать `ci-ok` зелёным,
поменяв сам workflow или Quarantine. Draft с зелёным CI тоже сливался, а имя check-а CI приходило из state file.

- Требование: [Что происходит](../issues/04-land-пути-проверок-draft-land-check.md#что-происходит)

## 2. Draft не сливается

Code: `harness/bin/land:1009-1018` · key lines: 1012, 1014

```js
        } else {
            if (v.state !== "OPEN") throw new Wait(`the PR is ${v.state}`)
            // a draft is not for merging, whatever its CI and review say
            if (v.isDraft) throw new Wait("draft")
            const head = v.headRefOid
            note = ready(st, pr, head, true, v)
            sha = await mergeOne(st, pr.number, head, () => ready(st, pr, head, false, v))
            log(`#${pr.number}: merged at ${head} as ${sha}`)
        }
        pr.result = { status: "merged", sha, head: v.headRefOid, ...(note ? { verification: note } : {}), at: now() }
```

- Что делает: draft ждёт с причиной `draft` до любого другого условия; то же чтение под замком main branch в
  `mergeOne`. Записанная заметка о путях проверок (`note`) идёт в `prs[].result.verification` и в строку PR.
- Почему здесь: Ticket называет `PR_FIELDS` и `isDraft`; почему draft не сливается — «Что строить».
- Без него: draft с зелёным CI и `review` сливался (test «draft» красный на старом коде).
- Требование: [Готово, когда, п. 1](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: PR, ставший draft-ом между двумя чтениями, ловит чтение под замком (test «draft-late»);
  draft с идущим CI ждёт с причиной `draft`, а не CI (test «draft-ci»).

## 3. Пути проверок против trail-а Ticket-а

Code: `harness/bin/land:887-914` · key lines: 893, 898, 902, 904, 906, 908

```js
function verified(st, pr, head, view) {
    const profile = profileOf(st)
    const list = verificationPaths(profile)
    if (!haveCommit(st, head, pr.number)) throw unread(`the head ${short(head)} is not in the checkout: its verification paths cannot be read`)
    const ref = `refs/remotes/${st.remote || "origin"}/${st.branch}`
    const base = git(["merge-base", head, ref], st.repo)
    const entries = changedEntries(st, base, head)
    const paths = entries.map((e) => e.path)
    // an absolute root: a relative one would resolve from the working directory (a realpath on macOS)
    const root = path.resolve(st.repo)
    // a verification path, a submodule at a folder above one (tools above tools/check-*), or any symbolic link
    const touched = entries.filter((e) => touchesVerificationPath(e.path, list, { root, symlink: e.symlink, gitlink: e.gitlink })).map((e) => e.path)
    const notes = []
    if (touched.length) {
        const tickets = field(profile, "tickets") || {}
        const t = readTrail({ repo: st.repo, ref, branch: view && view.headRefName, tickets, git: GIT, folder: ticketsRoot(st) ? null : ticketsFolder(st) })
        if (t.unread) throw unread(`the trail of the PR's ticket could not be read: ${t.reason}`)
        if (!t.ticket) throw new Wait(`verification paths, and the PR has no ticket (${t.reason}): ${touched.join(", ")} — the owner decides`)
        const name = `${t.ticket.epic} ${t.ticket.nn}`
        if (!t.trail) throw new Wait(`verification paths outside the trail of ${name} (${t.reason}): ${touched.join(", ")}`)
        const outside = touched.filter((p) => !namedByTrail(p, t.trail, { root }))
        if (outside.length) throw new Wait(`verification paths outside the trail of ${name}: ${outside.join(", ")}`)
        notes.push(`${touched.join(", ")} (trail of ${name})`)
    }
    for (const e of trailExtensions(st, profile, list, paths, base, head, root)) notes.push(`added to the trail of ${e.file}: ${e.paths.join(", ")}`)
    if (notes.length) log(`#${pr.number}: verification paths: ${notes.join("; ")}`)
    return notes.length ? `verification paths: ${notes.join("; ")}` : null
}
```

- Что делает: берёт список из Profile-а (никогда из state file), записи diff-а от merge-base (`git diff --raw`: путь и
  признаки symlink-а и submodule), считает затронутыми путь проверки, submodule на папке над ним и любой symlink, Ticket по ветке PR и его
  trail на вершине base branch (`ref`), а не на merge-base; путь вне trail-а — ждёт, PR без Ticket-а — ждёт владельца.
- Почему здесь: Ticket называет шаг `verified(st, pr, head)` в `ready()` и чтение trail-а на вершине base branch
  (решение владельца по возражению 2 critic-а).
- Без него: PR правил бы workflow CI или Quarantine без разрешения trail-а; при чтении на merge-base ветка, старше
  documents PR-а с расширением trail-а, ждала бы rebase.
- Требование: [Готово, когда, п. 2](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: `root` абсолютный (`path.resolve`), иначе путь через symlink на macOS считался бы вне
  репозитория. Silent mode (trail из папки Ticket-ов) проверен только unit test-ом helper-а.

## 4. PR, который расширяет trail

Code: `harness/bin/land:872-880` · key lines: 875, 876

```js
    const out = []
    for (const file of paths) {
        if (!file.startsWith(`${tickets}/`) || !/\.md$/i.test(file)) continue
        const before = at(base, file)
        const added = at(head, file).filter((g) => !before.includes(g) && isVerificationPath(g, list, { root }))
        if (added.length) out.push({ file, paths: added })
    }
    return out
}
```

- Что делает: для каждого файла Ticket-а под `tickets.root`, который правит PR, сравнивает trail на head и на
  merge-base и называет добавленные записи, которые сами — пути проверок.
- Почему здесь: Ticket требует, чтобы строка `land` называла такой PR; отметку `owner` для него ставит Ticket 10
  (возражение 1 critic-а).
- Без него: расширение trail-а на `.github/workflows/ci.yml` прошло бы молча, и владелец не знал бы, куда смотреть.
- Требование: [Готово, когда, п. 3](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: запись шире пути проверки (`.github/`) не называется — отмечено `shortcut:` в коде.

## 5. Имя check-а CI — из Profile-а

Code: `harness/bin/land:1451-1467` · key lines: 1459, 1461, 1464

```js
function ciCheckAgrees(file, st) {
    let profile
    try {
        profile = profileOf(st)
    } catch (e) {
        if (!(e instanceof Wait)) throw e
        return // every PR waits on the same reason in verified()
    }
    const named = field(profile, "workflow", "ci_check")
    if (typeof named === "string" && named.trim() !== "") {
        if (named !== st.ci_check)
            fail(`${file}: "ci_check" is ${JSON.stringify(st.ci_check)}, but the profile's workflow.ci_check is ${JSON.stringify(named)}: land merges on the check the profile names`)
    } else {
        ciCheckNote = `the CI check ${st.ci_check} is the state file's: the profile names no workflow.ci_check`
        log(ciCheckNote)
    }
}
```

- Что делает: state file с `ci_check`, отличным от `workflow.ci_check`, — отказ с обоими именами; без поля в
  Profile-е остаётся имя state file-а, и `ciCheckNote` выходит строкой в вывод `land`, не только в log.
- Почему здесь: Ticket: «Имя check-а CI — из `workflow.ci_check` Profile-а; state file с другим `ci_check` `land`
  отказывает». Почему без поля — не отказ: у worfy поля пока нет (команда владельцу из Ticket-а 02 не выполнена).
- Без него: Orchestrator мог бы назвать в state file check, который всегда зелёный.
- Требование: [Готово, когда, п. 4](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: случай «в Profile-е нет `workflow.ci_check`» — test «nocicheck» ищет строку в выводе.

## 6. `land --check <N>`: ответ за один PR

Code: `harness/bin/land:1529-1544` · key lines: 1531, 1534, 1536, 1539, 1543

```js
        const v = prView(st, Number(n))
        if (v.state !== "OPEN") return say(1, `waits: the PR is ${v.state}`)
        if (v.isDraft) return say(1, "waits: draft")
        const head = v.headRefOid
        const ticket = ticketOfBranch(v.headRefName, field(profile, "tickets", "branch"))
        const pr = { number: Number(n), checks, ...(ticket ? { epic: ticket.epic, ticket: ticket.nn } : {}) }
        st.ci_workflow = ciWorkflowOf(st, head)
        const note = ready(st, pr, head, false, v)
        if (v.mergeable === "CONFLICTING" || v.mergeStateStatus === "DIRTY") return say(1, `waits: conflict: rebase (mergeable ${v.mergeable}, mergeStateStatus ${v.mergeStateStatus})`)
        // GitHub has not computed it yet: a merge now may still meet a conflict, so not ready (a later --check may be)
        if (v.mergeable === "UNKNOWN") return say(1, "waits: mergeable UNKNOWN: GitHub has not computed it yet, ask again")
        return say(0, `ready${note ? ` — ${note}` : ""}`)
    } catch (e) {
        if (!(e instanceof Wait)) throw e
        return e.unread ? say(2, `unverified: ${firstLine(e.message)}`) : say(1, `waits: ${firstLine(e.message)}`)
    }
```

- Что делает: собирает условие из Profile-а (ветка, check CI, Check-и Pipeline-а), читает то же, что проход `land`,
  и отвечает одной строкой: exit 0 — готов, 1 — ждёт (и при `mergeable` UNKNOWN), 2 — нет ответа `gh`, git или
  Profile-а (`unread`, и при Profile-е без JSON). `pr` несёт epic и Ticket ветки, так что `ready()` проверяет и Code
  story.
- Почему здесь: Ticket называет новый режим и коды выхода; guard из спеки зовёт его перед `gh pr merge`.
- Без него: guard не мог бы спросить условие merge без state file.
- Требование: [Готово, когда, п. 5](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: workflow CI выводится из `details_url` check-а — форма URL GitHub на настоящем API не
  проверена; время ответа с настоящим `gh` не мерилось (311 ms со stand-in).

## 7. Один helper trail-а для `land` и guard-а

Code: `harness/lib/ticket-trail.cjs:167-190` · key lines: 168, 172, 173, 180, 183, 189

```js
    // the names are relative; the root is absolute, so the match never depends on the working directory
    const hits = names.filter((n) => isVerificationPath(n, [pattern], { root: path.resolve(folder || repo) }))
    const where = folder ? "the tickets folder" : ref
    // the branch names a ticket, but its file cannot be told: the ticket is known, its trail is not
    const none = { ...ticket, path: null }
    if (!hits.length) return { ticket: none, trail: null, reason: `${pattern} is not in ${where}` }
    if (hits.length > 1) return { ticket: none, trail: null, reason: `${hits.length} files in ${where}: ${hits.join(", ")}` }
    const file = hits[0]
    let text
    if (folder) {
        try {
            text = fs.readFileSync(path.join(folder, file), "utf8")
        } catch (e) {
            return { ticket: { ...ticket, path: file }, trail: null, reason: `${file} of the tickets folder could not be read: ${e.code || e.message}`, unread: true }
        }
    } else {
        const show = spawnSync(git, ["show", `${ref}:${file}`], { cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 })
        if (show.error || show.status !== 0) return { ticket: { ...ticket, path: file }, trail: null, reason: `git show ${ref}:${file} could not be read`, unread: true }
        text = show.stdout
    }
    const found = { ...ticket, path: file }
    if (!t.trail_section) return { ticket: found, trail: null, reason: "the profile has no tickets.trail_section" }
    const trail = trailPaths(text, t.trail_section)
    return trail ? { ticket: found, trail, reason: null } : { ticket: found, trail: null, reason: `${file} has no section ${JSON.stringify(t.trail_section)}` }
```

- Что делает: находит файл Ticket-а по `tickets.path` на `ref`, читает его через `git show <ref>:<путь>` (в Silent mode —
  из папки Ticket-ов), не из working tree, и отдаёт trail или причину, почему его нет; нечитаемый файл в обоих режимах —
  `unread`, и `land` отвечает «не может сказать», а не «ждёт».
- Почему здесь: Ticket: helper в `harness/lib/`, guard Ticket-а 03 читает trail тем же кодом.
- Без него: guard и `land` читали бы trail разным кодом и могли бы разойтись.
- Требование: [Готово, когда, п. 6](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: записи trail-а проекта с несколькими репозиториями сравниваются как написаны — `shortcut:`.

## 8. Symlink и submodule над путём проверки

Code: `harness/lib/verification-paths.cjs:240-244` · key lines: 241, 242, 243

```js
function touchesVerificationPath(file, paths, options = {}) {
    if (options.symlink) return normalizePath(file, options) !== null
    if (isVerificationPath(file, paths, options)) return true
    return options.gitlink === true && isVerificationParent(file, paths, options)
}
```

- Что делает: изменение считается правкой пути проверки, если путь сам в списке, если это submodule (mode 160000) на
  папке над glob-ом списка (`tools` над `tools/check-*`) или если это symlink — куда угодно внутри репозитория. Обычный
  файл папку не скрывает: с glob-ом `**/CLAUDE.md` иначе любой файл был бы «над» ним (review раунда 2).
- Почему здесь: review раунда 1 попросил правило в `lib/verification-paths.cjs`, чтобы его взял и guard из спеки;
  правило записано в спеке.
- Без него: PR с symlink-ом `.claude` → `docs/x` (и `docs/x/settings.json`) или с submodule `tools` сливался бы без
  trail-а (test-ы «link», «link-any», «parent» и unit test helper-а красные на мутантах); без условия `gitlink` любой
  файл ждал бы владельца (test «parent-file» и unit test `**/CLAUDE.md` красные на мутанте).
- Требование: [Решения по реализации](../spec.md#решения-по-реализации)
- Риски и пробелы test-ов: symlink считается всегда, даже если указывает в безобидную папку — trail должен его назвать.
  Submodule в test-е указывает на коммит, которого нет в origin: `land` смотрит только на режим записи.

## 9. Trail — только пункты списка; «Только читать» не разрешает правку

Code: `harness/lib/ticket-trail.cjs:101-110` · key lines: 102, 105, 107, 110

```js
        if (readOnly !== null) {
            if (line.trim() === "" || indentOf(line) > readOnly) continue
            readOnly = null
        }
        const ro = READ_ONLY.exec(line)
        if (ro) {
            readOnly = ro[1].length
            continue
        }
        if (!LIST_ITEM.test(line)) continue
```

- Что делает: путь считается только на строке пункта списка, как trail читает приложение worfy; абзац «Только читать:
  …» без маркера и строки продолжения ничего не дают. Пункт, который начинается с «Read only» / «Read-only» или тех же
  слов по-русски (`lib/input-words.json` `trailReadOnly`) и двоеточия, и его вложенные пункты (и после пустой строки)
  тоже не дают путей.
- Почему здесь: правило Ticket-ов — `harness/bin/TICKETS.md`, раздел **Trail**; review раунда 1 указал, что такие
  пути считались разрешёнными.
- Без него: Ticket, который только читает `CLAUDE.md`, разрешал бы его правку. На main так написано большинство
  Ticket-ов — абзацем (около 259 строк против 51 пункта списка, review раунда 2): test «readonly» с абзацем, unit test
  с формой настоящего Ticket-а и пустой строкой внутри пункта красные на мутантах.
- Требование: [Решения по реализации](../spec.md#решения-по-реализации)
- Риски и пробелы test-ов: путь, перенесённый на строку продолжения обычного пункта, теперь тоже не считается — PR
  ждёт, пока trail не назовёт его на строке пункта; в пункте «только просмотр» и других формулировках пути считаются.

## 10. Как проверено

`bash harness/bin/tests/land-verification.test.sh` — exit 0 (39 проверок; на коде раунда 1 — 16 FAIL из 19, новые
случаи раундов review — красные до правки или на мутанте); 19 мутантов (флаги `PR_FIELDS`, symlink, папка, «Только читать», UNKNOWN,
строка `ci_check`, оба чтения draft-а, `unread` папки, условие `gitlink`, строки вне пунктов списка, пустая строка в
пункте «Только читать») — все красные;
`land.test.sh`, `land-story.test.sh`, `land-epic-story.test.sh` — exit 0; `test/unit/ticket-trail.test.ts` —
exit 0; `test/unit/verification-paths.test.ts`, `plugin-neutral.test.sh` — exit 0; `pnpm lint`, `pnpm typecheck` — exit 0.

## Проверить себя

1. Почему PR, который сам дописал `.github/workflows/ci.yml` в свой trail, всё равно ждёт?
   - Ответ: trail читается на вершине base branch (`ref`), а правки самого PR-а там нет.
   - Строки: `harness/bin/land:891-902`
2. Чем `land --check` отличает «ждёт» от «не может сказать»?
   - Ответ: Wait с флагом `unread` (сбой `gh`, git или Profile-а) даёт exit 2, любой другой Wait — exit 1.
   - Строки: `harness/bin/land:1543`

## 11. Что нашёл review и что осталось

> VERIFIED
>
> Every finding from round 2 is fixed. Each fix has a test that goes red without it.
>
> **Round-2 findings:**
> - **[med] read-only paragraph: fixed.** `harness/lib/ticket-trail.cjs:110` now counts only list-item lines, using the same rule as `LIST_ITEM` at `:75`. Plain paragraphs and continuation lines allow nothing. The tests are `test/unit/ticket-trail.test.ts:102` (the shape of `worfy-continuity/01`, with unindented continuation lines) and `land-verification.test.sh:243`. With the fix removed, land merges a PR that edits `CLAUDE.md`.
> - **[low] parent-folder rule applied to regular files: fixed.** The rule now applies only to submodules (`harness/lib/verification-paths.cjs:243`, `harness/bin/land:855`). Symlinks still always count. The tests are `test/unit/verification-paths.test.ts:389` and `land-verification.test.sh:210`.
> - **[low] blank line inside a read-only item untested: fixed.** `ticket-trail.cjs:102` has a test at `ticket-trail.test.ts:121`. Mutant M10 from round 2 is now caught.
> - **[low] `SKILL.md` wrote a literal `null`: fixed.** `harness/skills/epic-wave/SKILL.md:1332` now turns both an empty value and `null` into the placeholder.
>
> **Sample (all tickets on origin/main):**
> - 1282 ticket files read. 227 of them name a path matching a verification glob (the 7 defaults plus the 23 worfy profile globs) in their «Где в коде» section.
> - 9 of the 227 (about 4%) would now wait wrongly. In each, the ticket means to edit a path that sits only on a continuation line:
>   - 7 clear cases: throughput/44 (`scripts/ci-ok.mjs`, `scripts/ci-scope.mjs`), multi-vendor/25, multi-vendor/27 and schedules/09 (`scripts/e2e-specs.table.json`), polish/128 (`harness/hooks/hooks.json`), link/25 (`tsconfig.test.node.json`) and auto-approve/12 (`scripts/ci-scope.mjs`, listed as "сверх следа", beyond the trail).
>   - 2 conditional cases ("only if needed"): limits-ledger/10 and windows/14.
> - 7 tickets put a verification path only on a paragraph or continuation line and would wait correctly. The path there is read-only or just described: harness/08, harness/14, harness/22, polish/45, throughput/62, throughput/66 and windows/72.
> - **App and trail agree on all 1282 tickets.** I ran the app's `codeSection` (`src/main/workflow/reader.ts:233`) and `trailPaths` side by side in a throw-away test file. Every trail path is in the app's list. The only paths the app lists and the trail drops are read-only list items: 95 such paths, which the app shows and the trail correctly leaves out.
> - Not "most tickets", and the rule errs toward waiting. The rule is written down in `harness/bin/TICKETS.md` («Trail») and in the spec.
>
> **New findings (this is round 3, so they are debt and do not block):**
> - `harness/lib/ticket-trail.cjs:110`: [low] debt: about 4% of tickets that name a verification path wrap it onto a continuation line, so their PR waits for a trail fix on main or for the owner. For example, throughput/44 lists `scripts/ci-ok.mjs` on the second line of a list item. Fix: ticket writers put each verification path on a list-item line of its own.
> - `harness/lib/ticket-trail.cjs:75`: [low] debt: numbered list items (`1. `) in a trail have no test. Mutant M5, which drops `\d+[.)]` from `LIST_ITEM`, survives. The trail would then drop numbered items the app still shows, so the two readers would disagree, though in the waiting direction.
>
> **Commands** (in worktree `rev-2380-r3` at 794a9e6a0, `HOME` set to a temporary folder):
> - `pnpm install --frozen-lockfile`: exit 0.
> - `land-verification.test.sh`: exit 0, 39/39 passed.
> - `land.test.sh`: exit 0, 142/142.
> - `land-story.test.sh`: exit 0, 30/30.
> - `plugin-neutral.test.sh`: exit 0, 37/37.
> - `node scripts/vitest-electron.mjs` on `verification-paths`, `ticket-trail` and `harness-evals-run`: exit 0, 236 passed and 4 skipped.
>
> **Mutants:** 7 run, 6 caught.
> - Caught: M1 (`ticket-trail.cjs:110` removed; unit test and land test both red), M2 (`:102`, blank-line check dropped), M3 (`verification-paths.cjs:243`, gitlink condition dropped; unit test and land test both red) and M4 (`land:855`, gitlink always false).
> - Survived: M5 (`ticket-trail.cjs:75`), the numbered-list gap above.
> - Each file was restored from its copy and `cmp` matched.
>
> **Could not verify:** Windows Git Bash runs, real `gh` or GitHub, lint, typecheck and the gate. The Code story and the Evidence lines belong to another lens.
>
> The worktree is removed and no processes are left running.
>
> Nothing else found.
>
> Orchestrator: the two round-3 lows are debt, not blockers; the wrapped-path rule is written in harness/bin/TICKETS.md («Trail»). Platform PR: the Windows verdict is the CI job (all Windows jobs pass).
>
> Review depth: medium — round 3

Code: `harness/lib/ticket-trail.cjs:110-110` · key lines: 110

```cjs
        if (!LIST_ITEM.test(line)) continue
```

Code: `test/unit/ticket-trail.test.ts:102-102` · key lines: 102

```ts
  it('takes only list items, as the app reads the trail: a plain paragraph allows nothing', () => {
```

Code: `harness/lib/verification-paths.cjs:243-243` · key lines: 243

```cjs
    return options.gitlink === true && isVerificationParent(file, paths, options)
```

Code: `harness/bin/land:855-855` · key lines: 855

```
        out.push({ path: parts[i + 1], symlink: was("120000"), gitlink: was("160000") })
```

Code: `test/unit/verification-paths.test.ts:389-389` · key lines: 389

```ts
  it('touchesVerificationPath: a regular file hides no folder, so the folder rule is not its', () => {
```
