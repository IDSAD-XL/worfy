# Code story — worfy-polish 130: `bin/land` держит PR со scope `pc`, пока открыт issue `pc-main-red`

Kind: pr · Epic: worfy-polish · Ticket: 130 · PR: - · Language: ru

## 1. Что было не так

ADR-0086, пункт 4: пока открыт issue GitHub с меткой `pc-main-red` (`main` красный на gate full ПК), PR со scope `pc`
не вливается. Правило было записано словами в skill epic-wave, но `harness/bin/land` — единственный путь merge у
Orchestrator-а — его не проверял: он держал PR только при красном CI на `main`. С 2026-11-17 по 2026-11-19 не меньше
12 PR со scope `pc` влиты при открытом issue `pc-main-red`.

- Требование: [Что происходит](../issues/130-land-держит-pr-со-scope-pc-при-открытом-pc-main-red.md#что-происходит)

## 2. Проверка `red_elsewhere`: issue по метке, потом команда проекта

Code: `harness/bin/land:638-667` · key lines: 640, 641, 646, 651, 659, 665, 666

```js
function elsewhereAllows(st, pr, head) {
    const rule = st.red_elsewhere
    if (!rule) return
    if (pr.main_fix) {
        log(`#${pr.number}: main_fix — not held by open ${rule.label} issues`)
        return
    }
    const what = `the open ${rule.label} issues`
    const list = ghJson(st, ["issue", "list", "--label", rule.label, "--state", "open", "--json", "number,title,url"], what)
    if (!Array.isArray(list)) throw new Wait(`${what}: gh printed no list`)
    const issues = list.filter((i) => i && Number.isInteger(i.number))
    if (!issues.length) return
    const named = `${rule.label} issue${issues.length > 1 ? "s" : ""} ${issues.map((i) => `#${i.number}`).join(", ")} ${issues.length > 1 ? "are" : "is"} open`
    if (documentsOnly(st, pr, head)) {
        log(`#${pr.number}: documents only — merged while ${named}`)
        return
    }
    const red = `main is red elsewhere: open ${rule.label} issue${issues.length > 1 ? "s" : ""} ${issues.map((i) => `#${i.number} ${JSON.stringify(String(i.title || ""))} ${i.url || ""}`.trim()).join(", ")}`
    if (!haveCommit(st, head, pr.number)) throw new Wait(`${red} — git has not got the head ${short(head)} to ask red_elsewhere.needs: unverified, the PR waits`)
    const base = git(["merge-base", head, `refs/remotes/${st.remote || "origin"}/${st.branch}`], st.repo)
    // the SHAs are hex: substituted as they are, the command reads the same in sh and in cmd.exe
    const r = sh(rule.needs.replace(/<base>/g, base).replace(/<head>/g, head), st.repo)
    log(`#${pr.number}: red_elsewhere.needs ${short(base)} ${short(head)} — exit ${r.code}${r.code > 1 ? `: ${firstLine(r.err || r.out)}` : ""}`)
    if (r.code === 0) {
        log(`#${pr.number}: red_elsewhere.needs exit 0 — merged while ${named}`)
        return
    }
    if (r.code === 1) throw new Wait(`${red} — the PR needs that machine (red_elsewhere.needs exit 1) and waits until the issue is closed`)
    throw new Wait(`${red} — red_elsewhere.needs exit ${r.code}, not 0 or 1: unverified, the PR waits`)
}
```

- Что делает: без `red_elsewhere` в state file сразу выходит — поведение прежнее. PR с `main_fix` не держит и пишет об
  этом в log. Иначе читает открытые issue метки через `gh issue list`; ошибка gh — `Wait` (PR ждёт, `LAND=unverified`).
  Нет issue — выходит. PR только с документами пропускает с log-строкой. Остальным запускает команду проекта `needs` в
  checkout-е `main`, подставив точку ответвления и head: exit 1 — PR ждёт с причиной, где номер, заголовок и URL issue;
  exit 0 — вливается, log говорит, при каком открытом issue; любой другой — ждёт как непроверенный.
- Почему здесь: Ticket называет `harness/bin/land` и его `mainAllows` / `documentsOnly`. Решать, какие PR держать, —
  дело команды проекта, не `land` (Ticket, «Что делаем», п. 2; ADR-0074 — Harness без проекта). Подстановка SHA вместо
  `origin/main` — чтобы команда одинаково читалась в `sh` и `cmd.exe` (Git Bash на Windows, ADR-0056); записано в «Итог».
- Без него: `land` вливает PR со scope `pc` при красном `main` на ПК — то, что случилось с 12 PR.
- Требование: [Что делаем, п. 1–5](../issues/130-land-держит-pr-со-scope-pc-при-открытом-pc-main-red.md#что-делаем)
- Риски и пробелы test-ов: в test-ах stand-in gh и stub команды scope; настоящий `gh issue list` и
  `scripts/windows-verdict-scope.mjs` под `land` не запускались. При сбое `gh issue list` ждёт и PR, которому ПК не
  нужен (issue читается раньше команды).

## 3. Проверка встаёт в условие merge — и до lock-а, и под ним

Code: `harness/bin/land:755-764` · key lines: 763

```js
function ready(st, pr, head, carry) {
    ciGreen(st, head)
    sameChange(st, pr, head)
    const marks = statuses(st, head)
    reviewed(st, pr, head, marks, carry)
    checked(pr, head, marks)
    storyGreen(st, pr, head)
    mainAllows(st, pr, head)
    elsewhereAllows(st, pr, head)
}
```

- Что делает: `ready` — всё условие merge PR. `land` зовёт его перед lock-ом `main` и ещё раз под lock-ом, перед самым
  `gh pr merge`; так issue, открытый, пока `land` ждал lock, тоже останавливает merge.
- Почему здесь: рядом с `mainAllows` — проверкой красного CI на `main`, той же природы. Почему именно после неё — не
  записано.
- Без него: функция из шага 2 есть, но никто её не вызывает — это и есть mutant «не читать issue», на котором 9 case-ов
  `land.test.sh` красные.
- Требование: [Готово, когда](../issues/130-land-держит-pr-со-scope-pc-при-открытом-pc-main-red.md#готово-когда)
- Риски и пробелы test-ов: не записано.

## 4. State file получает метку и команду из блока skill-а

Code: `harness/skills/epic-wave/SKILL.md:1293-1293` · key lines: 1293

```js
  docs_check: val(docs), docs_only: val(docsOnly), red_elsewhere: val(redLabel) && val(redNeeds) ? { label: redLabel, needs: redNeeds } : null, tickets_root, prs: list }, null, 2) + "\n")
```

- Что делает: блок, которым Orchestrator пишет state file `land`, берёт два новых аргумента — метку и команду (worfy:
  `pc-main-red` и `node scripts/windows-verdict-scope.mjs <base> <head>`). Оба пустые — `red_elsewhere: null`, проверка
  выключена.
- Почему здесь: Ticket, «Что делаем», п. 3 — настройка рядом с `docs_check` и `docs_only`, полями того же state file;
  profile не меняется.
- Без него: поле есть в `land`, но Orchestrator его не заполняет — проверка выключена для всех.
- Требование: [Что делаем, п. 3 и 6](../issues/130-land-держит-pr-со-scope-pc-при-открытом-pc-main-red.md#что-делаем)
- Риски и пробелы test-ов: правило работает, только если Orchestrator передаст метку и команду; пустые аргументы его
  молча выключают.

## 5. Test: issue держит PR со scope `pc`, PR без него вливается

Code: `harness/bin/tests/land.test.sh:550-560` · key lines: 552, 553, 555, 557, 559

```bash
new_world elsewhere 1 2
state 1 2
elsewhere; issue_open
echo 0 >"$GHD/scope-$(head_of 2)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merged_of 1)" = 0 ] && grep -qxF "$HELD_REASON" "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' && [ "$(q "$S" 's.prs[0].result.kind')" = waits ] \
    && ok "red elsewhere: an open issue of the label holds a PR the scope command names (exit 1); the reason names the issue, its title and URL; exit 3" || bad "red elsewhere held: exit $rc: $(cat "$W/out")"
[ "$(merged_of 2)" = 1 ] && grep -q '^#2 merged ' "$W/out" && grep -q "Z #2: red_elsewhere.needs exit 0 — merged while pc-main-red issue #1513 is open" "$W/state.log" \
    && ok "red elsewhere: a PR the scope command does not name (exit 0) merges while the issue is open, the log says why" || bad "red elsewhere runner: $(cat "$W/out") $(grep '#2' "$W/state.log")"
grep -qx 'issue list --label pc-main-red --state open --json number,title,url' "$GHD/log" \
    && ok "red elsewhere: the open issues come from gh issue list --label <label> --state open" || bad "red elsewhere gh: $(grep '^issue' "$GHD/log")"
```

- Что делает: два PR при открытом issue #1513. Команда scope (stub) отвечает 1 для PR 1 и 0 для PR 2: PR 1 ждёт с
  точной причиной, PR 2 влит, log говорит почему, gh спрошен с меткой. Следующие case-ы того же раздела: документы,
  `main_fix`, сбой gh, команда с exit 2, закрытый issue, `land` без `red_elsewhere`, issue, открытый во время ожидания
  lock-а.
- Почему здесь: Ticket, «Готово, когда», п. 5 — новые случаи в `land.test.sh` со stand-in gh из `land-world.sh`.
- Без него: mutant «не читать issue» проходил бы незамеченным.
- Требование: [Готово, когда, п. 1–5](../issues/130-land-держит-pr-со-scope-pc-при-открытом-pc-main-red.md#готово-когда)
- Риски и пробелы test-ов: stub scope отвечает по head из файла, а не по diff — правило PC_ONLY здесь не проверяется
  (его проверяют test-ы самого `windows-verdict-scope.mjs`).

## 6. Как проверено

`bash harness/bin/tests/land.test.sh` до кода — exit 1 (14 FAIL новых case-ов), после — exit 0 (passed 137). Mutant
«не читать issue» (вызов `elsewhereAllows` убран из `ready`) — exit 1, 9 FAIL. `land-story.test.sh`,
`land-epic-story.test.sh`, `agents-text.test.sh` — exit 0. `pnpm lint`, `pnpm typecheck` — exit 0. gate fast не
запускался: file-watcher test-ы на этом Mac красные из-за fseventsd. Вердикт Windows — job-ы Windows в CI PR.

## Проверить себя

1. Почему PR, которому ПК не нужен, всё равно ждёт, если `gh issue list` не ответил?
   - Ответ: issue читается раньше команды scope, и ошибка gh бросает `Wait` до того, как PR успели разделить на `pc` и
     `runner`. Цена выбрана ради того, чтобы при закрытом issue команда scope вообще не запускалась.
   - Строки: `harness/bin/land:646-649`
2. Issue открыли, пока `land` ждал lock `main`. Будет ли merge?
   - Ответ: нет: `ready` с `elsewhereAllows` вызывается ещё раз под lock-ом, перед `gh pr merge`, и читает issue заново.
   - Строки: `harness/bin/land:755-764`
3. Что произойдёт, если Orchestrator соберёт state file, оставив метку пустой?
   - Ответ: `red_elsewhere` будет `null`, и `elsewhereAllows` выйдет на первой проверке — PR со scope `pc` снова пройдут
     при открытом issue.
   - Строки: `harness/skills/epic-wave/SKILL.md:1293-1293`
