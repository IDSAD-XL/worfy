# Code story — worfy-continuity 11: Harness: hook ветки `compact` возвращает агенту состояние

Kind: pr · Epic: worfy-continuity · Ticket: 11 · PR: - · Language: ru

## 1. Что было не так

После compaction у агента остаётся только summary. `SessionStart` в `harness/hooks/hooks.json` стоял без matcher-а, а
`inject-rules.mjs` и `session-start.mjs` на `source` не смотрят: после compaction они вставляют то же, что при старте, —
правила роли, но не Epic, Wave, Ticket и состояние worktree. Spike 01 показал, что `SessionStart` с `source: compact`
приходит и в главной Session, и в Subagent-е, но по входу hook-а Subagent не отличить: нет `agent_id`, а
`transcript_path` — главной Session.

- Требование: [Что происходит](../issues/11-hook-ветки-compact.md#что-происходит)

## 2. Hook только на ветке `compact`

Code: `harness/hooks/hooks.json:41-50` · key lines: 42, 46, 47

```json
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/after-compact.mjs\"",
            "timeout": 30
          }
        ]
      },
```

- Что делает: Claude Code и Codex запускают `after-compact.mjs` только на `SessionStart` с источником `compact`; у
  остальных групп `SessionStart` matcher-а по-прежнему нет, поэтому старт Session не меняется.
- Почему здесь: Ticket называет `hooks.json` в «Где в коде» и matcher `compact`; Codex читает тот же `hooks.json` и
  знает этот matcher («Итог» spike-а 01, пункт 5), поэтому `src/main/vendors/codex/harness-hooks.ts` не правился: он
  считает команды из самого `hooks.json`. Почему 30 с — не записано; hook запускает до пяти программ Harness, одна из
  них читает gh.
- Без него: после compaction агент получает обратно только правила роли.
- Требование: [Что делаем, пункт 1](../issues/11-hook-ветки-compact.md#что-делаем)
- Риски и пробелы test-ов: test проверяет matcher в `hooks.json` и молчание hook-а на `startup`, `resume`, `clear`;
  что Claude Code и Codex действительно запускают hook после compaction, показал spike 01, а не test.

## 3. Роль решает место работы

Code: `harness/hooks/after-compact.mjs:260-274` · key lines: 261, 264, 267, 268, 269

```js
    let additionalContext
    if (gitDir && commonDir && path.resolve(gitDir) !== path.resolve(commonDir)) {
        // A linked worktree: an implementer's when its branch is a ticket's.
        const ticket =
            (formed && all.find((t) => t?.epic === formed.epic && t?.num === formed.num)) || (branch && branch !== "HEAD" && all.find((t) => t?.branch === branch))
        if (!ticket) return
        additionalContext = await implementerContext({ cwd, top, branch, ticket, fits })
    } else {
        const wanted = process.env.WORFY_EPIC ?? ""
        let epic = epics.has(wanted) ? wanted : formed && epics.has(formed.epic) ? formed.epic : ""
        if (!epic) epic = await firstInPlay(cwd)
        if (!epic || !epics.has(epic)) return
        additionalContext = await orchestratorContext({ cwd, epic, fits })
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }) + "\n")
```

- Что делает: в linked worktree, чья ветка — ветка Ticket-а (форма `tickets.branch` профиля или строка `Branch:`
  Ticket-а в Silent mode), отдаёт implementer-у файл Ticket-а и `git status --short`; worktree без своего Ticket-а
  (detached worktree reviewer-а) — молчание. В main checkout отдаёт Orchestrator-у `wave-brief <epic>`; Epic — из
  `WORFY_EPIC`, если у такого Epic-а есть Ticket, иначе Epic ветки, иначе первый из Epics in play, как их упорядочивает
  `stage-lines.mjs`.
- Почему здесь: «Итог» spike-а 01, «Решения для Ticket-ов», пункт 11: роль брать из `cwd` и ветки, вход hook-а её не
  даёт. Порядок выбора Epic-а — из «Что делаем», пункт 1. Почему worktree без Ticket-а молчит, а не получает
  `wave-brief`, — вывод из пункта 3 «Что делаем» («без Ticket-а hook молчит»).
- Без него: implementer после compaction получил бы `wave-brief` чужой Wave вместо своего Ticket-а.
- Требование: [Что делаем, пункты 1 и 3](../issues/11-hook-ветки-compact.md#что-делаем)
- Риски и пробелы test-ов: совпадает ли `cwd` во входе hook-а Subagent-а с его worktree, spike 01 не проверял; если
  нет, implementer получит вид Orchestrator-а, и его держит запасная строка `common.md` (Ticket 10). implementer в
  режиме `parallel: single` работает в main checkout и тоже получает вид Orchestrator-а.

## 4. Предел: Stage-строка, Ticket-ы в работе и открытые PR первыми

Code: `harness/hooks/after-compact.mjs:150-162` · key lines: 158, 159, 161

```js
function ordered(brief) {
    const head = []
    const sections = []
    for (const line of brief.split("\n")) {
        if (line.startsWith("## ")) sections.push({ name: line.slice(3).trim(), lines: [line] })
        else if (sections.length > 0) sections[sections.length - 1].lines.push(line)
        else head.push(line)
    }
    const text = (lines) => lines.join("\n").replace(/\n+$/, "")
    const first = FIRST_SECTIONS.flatMap((name) => sections.filter((s) => s.name === name))
    const rest = sections.filter((s) => !first.includes(s))
    return [text(head), ...[...first, ...rest].map((s) => text(s.lines))].filter(Boolean).join("\n\n")
}
```

- Что делает: ставит голову `wave-brief` (заголовок, Stage-строку, checkout), затем разделы `Waiting` и `Open PRs`,
  затем остальные в их порядке; `cut` потом режет по целой строке, и последняя строка называет команду с полным текстом.
- Почему здесь: риск 12 spec-а: `wave-brief` укладывается в 11 000 байт, а Claude Code режет `additionalContext` после
  10 000 знаков; ответ spec-а — Stage-строка, Ticket-ы в работе и открытые PR первыми.
- Без него: при длинном разделе `Land` обрезка съела бы Ticket-ы в работе и PR.
- Требование: [Что делаем, пункт 2](../issues/11-hook-ветки-compact.md#что-делаем)
- Риски и пробелы test-ов: порядок держится на названиях разделов `wave-brief`; переименование раздела там уведёт его
  в хвост без ошибки. Test с длинным `wave-brief` (заглушка) это ловит только для нынешних названий.

## 5. На Codex — ещё и предел в байтах

Code: `harness/hooks/after-compact.mjs:126-128` · key lines: 128

```js
const chars = (s) => [...s].length
/** Whether `text` fits the limit: characters, and on Codex bytes too. */
const fitter = (codex) => (text) => chars(text) <= LIMIT && (!codex || Buffer.byteLength(text, "utf8") <= LIMIT)
```

- Что делает: текст для Claude Code держится в 10 000 знаков; если вход от Codex (`codex-input.mjs`), ещё и в
  10 000 байт.
- Почему здесь: `test/contract/codex-parity.test.ts` записывает предел Codex — 2 500 токенов, около 10 000 байт;
  длиннее Codex уносит текст в файл и даёт модели только начало. В Ticket-е этого нет.
- Без него: русский Ticket в 6 000 знаков (около 11 000 байт) у Codex ушёл бы в файл.
- Требование: [Готово, когда, пункт 3](../issues/11-hook-ветки-compact.md#готово-когда)
- Риски и пробелы test-ов: оценка «байты / 4» приблизительна, счётчика Codex в репозитории нет; настоящим Codex не
  проверено.

## 6. Что сознательно не меняли

- `src/main/vendors/codex/harness-hooks.ts` — Codex берёт hook из того же `hooks.json`.
- `harness/hooks/hook-stdin.mjs` (таблица `FIRST_BYTE_MS`) — нет в «Где в коде»; ожидание входа (5 с) — в самом hook-е.
- `harness/README.md` (таблица `hooks/`) — нет в «Где в коде».
- `WORFY_EPIC` в окружении Session — Ticket 12; русская страница — Ticket 14.

## 7. Как проверено

- `bash harness/hooks/tests/session-hooks.test.sh` — до hook-а 16 провалов, после — exit 0, 53 проверки. Мутации в
  копии Harness: пустой `FIRST_SECTIONS` — 2 провала (длинный brief, байты Codex); worktree без Ticket-а не молчит — 1
  провал.
- `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0.
- Полный `pnpm test` нашёл ещё два места: `harness/hooks/tests/rules-hooks.test.sh` держит список всех hook-ов
  `hooks.json` (в него добавлена строка `SessionStart|compact|…after-compact.mjs"|30`), а
  `harness/bin/tests/harness-home.test.sh` не пускает кириллицу в test-ы Harness (заполнитель для предела в байтах —
  `é`, а не кириллическая буква). После правки оба — exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` под временным HOME и gate fast — коды выхода в отчёте implementer-а.

## Проверить себя

1. Почему hook выбирает роль по worktree и ветке, а не по входу события?
   - Строки: `harness/hooks/after-compact.mjs:261-262`
   - Ответ: во входе `SessionStart` Subagent-а нет `agent_id`, а `transcript_path` — главной Session (spike 01); отличить
     implementer-а от Orchestrator-а можно только по месту работы.
2. Что получит Orchestrator, если раздел `Land` у `wave-brief` длиннее предела?
   - Строки: `harness/hooks/after-compact.mjs:158-161`
   - Ответ: голову со Stage-строкой, `Waiting` и `Open PRs` целиком, затем столько строк `Land`, сколько влезет, и
     строку с командой `wave-brief <epic>` для полного текста.

## 8. Что нашёл review и что осталось

> VERIFIED
> Consider: harness/hooks/after-compact.mjs:46 — the 5 s stdin wait is a local constant, not an entry in hook-stdin.mjs FIRST_BYTE_MS, so test/contract/harness-hook-stdin.test.ts:376 (wait at most half the hooks.json limit) does not cover this hook (low); after-compact.mjs:261-266 — a reviewer in a worktree on a ticket's branch (not detached) is told it is that ticket's implementer (low); after-compact.mjs:44-51 — the worst-case sum of the sub-process timeouts (~46 s) exceeds the 30 s hook limit, reachable only when programs hang; Claude Code then drops the hook (low).
> Noted: harness/hooks/tests/session-hooks.test.sh:377 — the Product Session check passes with the guard at after-compact.mjs:221 deleted (stage-lines.mjs covers for it); pass WORFY_EPIC there (low); session-hooks.test.sh:312-333 — the priority WORFY_EPIC over the branch's epic (after-compact.mjs:268-269) is not pinned by a test (low); test/harness-shell-tests.ts:115,187 — session-hooks.test.sh shard weights are stale (low, outside the diff).
> Review depth: low — default: the profile has no review.depth.wave
> Review tokens: 106768

Code: `harness/hooks/after-compact.mjs:46-46` · key lines: 46

```mjs
const FIRST_BYTE_MS = 5000
```

Code: `test/contract/harness-hook-stdin.test.ts:376-376` · key lines: 376

```ts
    const { FIRST_BYTE_MS } = await load()
```

Code: `harness/hooks/tests/session-hooks.test.sh:377-377` · key lines: 377

```sh
compact "$CP" compact WORFY_SESSION_KIND=product
```

Code: `test/harness-shell-tests.ts:115-115` · key lines: 115

```ts
    'hooks/tests/session-hooks.test.sh': 17,
```
