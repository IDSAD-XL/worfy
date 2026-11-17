# Code story — worfy-stuck-agents 07: Call log Harness, только запись: повторы упавших вызовов считаются, агент ничего не видит

Kind: pr · Epic: worfy-stuck-agents · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

Повторы одной и той же упавшей команды никто не считал: разбор 2026-10-15 насчитал 0 случаев, но без данных — Journal
команд не пишет. Условие вернуться к детектору зацикливания — три случая и больше, а посчитать их было нечем. У Harness не
было PostToolUse hook-а.

- Требование: [Что происходит](../issues/07-call-log-harness-только-запись.md#что-происходит)

## 2. Hook на PostToolUse и PostToolUseFailure для всех tools

Code: `harness/hooks/hooks.json:167-178` · key lines: 167, 172, 173

```json
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/calls.mjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUseFailure": [
```

- Что делает: регистрирует `calls.mjs` на оба события без matcher-а, то есть на каждый вызов tool-а, с пределом 5 с. Codex читает тот же файл: `PostToolUse` он знает, `PostToolUseFailure` — нет и пропускает.
- Почему здесь: Ticket называет `harness/hooks/hooks.json` и событие, timeout 5 с ([Что делаем, п. 1](../issues/07-call-log-harness-только-запись.md#что-делаем)).
- Без него: hook не запускался бы ни у одного агента, и `loop-log` всегда показывал бы `cases: 0`.
- Требование: [Что делаем, п. 1](../issues/07-call-log-harness-только-запись.md#что-делаем)
- Риски и пробелы test-ов: hook идёт на каждом вызове; время одного запуска на Mac — медиана 56.8 ms против 36.7 ms у пустого node (записано в «Итог» Ticket-а). На Windows время не мерили. Список hook-ов проверяет `rules-hooks.test.sh` (две новые строки).

## 3. Запись вызова: owner, нормализованный ввод и исход по Vendor-ам

Code: `harness/hooks/calls.mjs:96-128` · key lines: 101, 104, 109, 110, 118, 122

```js
function recordOf(payload) {
    const event = payload.hook_event_name
    if (event !== "PostToolUse" && event !== "PostToolUseFailure") return null
    const tool = str(payload.tool_name)
    if (!tool) return null
    if (event === "PostToolUseFailure" && payload.is_interrupt === true) return null
    const input = payload.tool_input
    const command = tool === "Bash" ? str(input?.command).trim() : ""
    if (command && isCiWait(command)) return null

    const codex = isCodexInput(payload)
    let out
    let fail
    if (event === "PostToolUseFailure") [out, fail] = [`fail:${hash(str(payload.error))}`, true]
    else if (codex) [out, fail] = codexOutcome(payload.tool_response)
    else [out, fail] = ["ok", false]

    const cwd = str(payload.cwd) || process.cwd()
    const paths = editedPaths(tool, input)
    const record = { t: new Date().toISOString(), tool, in: "", out, fail }
    let head
    if (paths) {
        record.files = paths.map((p) => [hash(path.resolve(cwd, p)), contentHash(path.resolve(cwd, p))])
        record.in = hash(`${tool}\u0000${record.files.map((f) => f.join(":")).join("\u0000")}`)
        head = paths.join(" ")
    } else if (tool === "Bash") {
        record.in = hash(`${tool}\u0000${command}`)
        head = command
    } else {
        head = stable(input ?? null)
        record.in = hash(`${tool}\u0000${head}`)
    }
    return { record, head: Array.from(head).slice(0, HEAD).join(""), vendor: codex ? "codex" : "claude" }
```

- Что делает: из hook input делает запись call log: tool, хэш ввода (команда без пробелов по краям; у правки — хэш пути и хэш содержимого файла после неё), исход и признак неуспеха. Claude Code: `PostToolUse` — `ok`, `PostToolUseFailure` — `fail:` и хэш текста `error`. Codex: `exit:<код>:<хэш вывода>`, а без exit code — `out:<хэш>` с неизвестным успехом. Прерывание человеком и команды ожидания CI не пишутся.
- Почему здесь: Ticket называет файл и состав записи ([Что делаем, п. 2](../issues/07-call-log-harness-только-запись.md#что-делаем)); почему у правки берётся содержимое после неё, а не сам ввод, не записано.
- Без него: у Codex-вызова не было бы исхода — PostToolUseFailure там нет, и неуспех виден только по `Exit code:` в выводе.
- Требование: [Что делаем, п. 2](../issues/07-call-log-harness-только-запись.md#что-делаем)
- Риски и пробелы test-ов: у shell-вызова Codex exit code нет, такой исход (`fail: null`) шаблоны не считают ни неуспехом, ни успехом (решение записано в «Итог» Ticket-а); живой payload `PostToolUseFailure` Claude Code не записан — test-ы строят его по типу SDK.

## 4. Шаблоны: тот же неуспех, туда и обратно, A-B-A-B

Code: `harness/hooks/loop-patterns.mjs:39-85` · key lines: 39, 40, 46, 56, 66, 82

```js
const failed = (call) => call.fail === true
const succeeded = (call) => call.fail === false
const key = (call) => `${call.tool}\u0000${call.in}\u0000${call.out}`

// The same call with the same failed outcome: how many of `calls` repeat the newest one.
function sameFailure(calls) {
    const last = calls[calls.length - 1]
    if (!failed(last)) return 0
    const k = key(last)
    return calls.filter((call) => key(call) === k).length
}

// An edit back and forth: for a file of the newest edit, the run of returns at the end of its successful
// edits — an edit that left the content of two edits before, after one that did not. Two returns (A, B, A,
// B) are the 3rd repeat: the count is the returns plus one.
function editBackAndForth(calls) {
    const last = calls[calls.length - 1]
    if (!succeeded(last) || !Array.isArray(last.files)) return 0
    let most = 0
    for (const [file] of last.files) {
        const contents = []
        for (const call of calls) {
            if (!succeeded(call) || !Array.isArray(call.files)) continue
            for (const [f, content] of call.files) if (f === file) contents.push(content)
        }
        let returns = 0
        for (let k = contents.length - 1; k >= 2; k--) {
            if (contents[k] !== contents[k - 2] || contents[k] === contents[k - 1]) break
            returns++
        }
        if (returns > 0) most = Math.max(most, returns + 1)
    }
    return most
}

// A-B-A-B: how many times the pair of the two newest calls repeats in a row at the end, each call with the
// same outcome. Two different calls, one of them failed: two successes in turn are work, not a loop, and so
// are two calls of unknown outcome.
function abab(calls) {
    const n = calls.length
    if (n < 2) return 0
    const a = key(calls[n - 2])
    const b = key(calls[n - 1])
    if (a === b || (!failed(calls[n - 2]) && !failed(calls[n - 1]))) return 0
    let pairs = 0
    for (let i = n; i >= 2 && key(calls[i - 2]) === a && key(calls[i - 1]) === b; i -= 2) pairs++
    return pairs
```

- Что делает: для самого нового вызова считает номер повтора по каждому шаблону: сколько раз среди последних 20 был тот же вызов с тем же неуспешным исходом; сколько раз подряд файл возвращался к содержимому двух правок назад (два возврата — третий повтор); сколько раз подряд повторилась пара двух последних вызовов.
- Почему здесь: Ticket требует чистый модуль `harness/hooks/loop-patterns.mjs` ([Что делаем, п. 3](../issues/07-call-log-harness-только-запись.md#что-делаем)).
- Без него: hook писал бы вызовы, но ни один случай не попал бы в `loops.jsonl`.
- Требование: [Что делаем, п. 3](../issues/07-call-log-harness-только-запись.md#что-делаем)
- Риски и пробелы test-ов: A-B-A-B без единого неуспеха не считается — это решение без владельца, в «Итог» Ticket-а. Исход без exit code (`fail: null`, shell-вызов Codex) не неуспех для «того же неуспеха» и A-B-A-B (`failed`) и не успех для «туда и обратно» (`succeeded`): повтор shell-команды на Codex случая не даёт. Один зацикленный вызов может дать два случая сразу (тот же неуспех и A-B-A-B), `loop-log` посчитает оба.

## 5. Строка случая: один раз на шаблон и owner, хвост в 2000 строк

Code: `harness/hooks/calls.mjs:200-215` · key lines: 204, 210, 214

```js
    const seen = new Set()
    for (const line of lines) {
        try {
            const l = JSON.parse(line)
            if (l.session === session && (l.agent_id ?? "") === agentId) seen.add(`${l.pattern}\u0000${l.level}`)
        } catch {}
    }
    const fresh = found
        .filter((f) => !seen.has(`${f.pattern}\u0000${f.level}`))
        .map((f) =>
            JSON.stringify({ t: call.record.t, session, agent_id: agentId || null, pattern: f.pattern, level: f.level, tool: call.record.tool, command: call.head, vendor: call.vendor }),
        )
    if (fresh.length === 0) return
    lines = lines.concat(fresh)
    if (lines.length > MAX_LOOPS) replace(loops, `${lines.slice(-MAX_LOOPS).join("\n")}\n`)
    else fs.appendFileSync(loops, `${fresh.join("\n")}\n`)
```

- Что делает: по уже записанным строкам `loops.jsonl` той же Session и того же `agent_id` отбрасывает шаблон и уровень, которые уже были, дописывает новые строки (время, Session, `agent_id`, шаблон, уровень, tool, начало команды до 200 символов, Vendor) и держит в файле последние 2000 строк.
- Почему здесь: Ticket задаёт «один раз на шаблон и owner» и 2000 строк ([Что делаем, п. 2](../issues/07-call-log-harness-только-запись.md#что-делаем)).
- Без него: пятый, шестой повтор того же вызова добавлял бы новые `would-deny`, и `cases` считал бы повторы, а не случаи.
- Требование: [Что делаем, п. 2](../issues/07-call-log-harness-только-запись.md#что-делаем)
- Риски и пробелы test-ов: два параллельных вызова одного агента могут переписать call log одновременно, и одна запись потеряется; запись идёт через временный файл и rename, поэтому файл не рвётся.

## 6. Агент ничего не видит: exit 0, пустой stdout, предел на ввод

Code: `harness/hooks/calls.mjs:218-223` · key lines: 218, 221

```js
// A pipe that stays open and sends nothing gives "" after INPUT_MS (hook-stdin.mjs): the hook does not hold
// the tool call until hooks.json's limit kills it. A closed stdin ends the wait at once.
try {
    main(await readStdin(INPUT_MS))
} catch {}
process.exitCode = 0
```

- Что делает: читает stdin через `readStdin` из `hook-stdin.mjs` и вызывает `main`; любая ошибка проглатывается, код выхода 0, в stdout ничего. Закрытый stdin заканчивает ожидание сразу; если pipe открыт и молчит, через 2 с без первого байта ввод пустой, и процесс выходит сам; после первого байта ввод читается до конца.
- Почему здесь: Ticket требует «ничего не пишет в stdout, всегда exit 0, ошибку чтения или записи глотает» ([Что делаем, п. 2](../issues/07-call-log-harness-только-запись.md#что-делаем)).
- Без него: hook на каждом вызове мог бы показать агенту ошибку или задержать вызов до своего предела в 5 с.
- Требование: [Готово, когда](../issues/07-call-log-harness-только-запись.md#готово-когда)
- Риски и пробелы test-ов: `calls.test.sh`, раздел 7, проверяет оба края: закрытый stdin — выход меньше чем за 1.5 с, молчащий открытый pipe — выход сам около 2 с (не раньше 1.9 с, не позже 4.5 с), exit 0 и пустой stdout в обоих; битый JSON, пустой ввод и папка без права записи — там же. Ввод, у которого первый байт пришёл, а конец нет, обрывает только предел 5 с `hooks.json` — test-а на это нет.

## 7. Что сознательно не меняли

Агенту ничего не показывается: подсказка, отказ в `guard.mjs` и `blocked: loop` — отдельный Epic после `cases: 3`.
`test/contract/codex-parity.test.ts` не тронут: его таблица перечисляет гарантии со сценарием на fake app-server, а
fake не проигрывает PostToolUse в ходе; Codex-входы call log проверяет `harness-codex-hooks.test.ts`.

## 8. Как проверено

`bash harness/hooks/tests/calls.test.sh` — exit 0 (35 проверок); `bash harness/bin/tests/loop-log.test.sh` — exit 0
(16 проверок); `pnpm test test/unit/loop-patterns.test.ts test/contract/harness-codex-hooks.test.ts` — exit 0 (четыре
новых test-а contract-а красные без hook-а в `hooks.json`). Раунд 2 ревью: каждая новая проверка красная на своём mutant-е —
предел 7 дней как 30 дней или 60 с, без фильтра расширений, без `.tmp`; таймер без `unref` (закрытый stdin ждёт 2 с) и
ожидание 30 с; исход `fail: null` как неуспех или как успех правки; `loop-log` без замены управляющих символов, без C1, без
Vendor.

## Проверить себя

1. Почему повтор `gh pr checks` с ненулевым exit code не даёт строки в `loops.jsonl`, и где это решается?
   - Ответ: его ненулевой exit code значит «CI ещё идёт»; `recordOf` отбрасывает такую команду через `isCiWait` ещё до записи в call log.
   - Строки: `harness/hooks/calls.mjs:104-104`
2. Как на Codex отличается неуспешный `apply_patch` от успешного, если события PostToolUseFailure там нет?
   - Ответ: по началу `tool_response` — `Exit code: N`; код не 0 — неуспех, а строка `Wall time` вырезается, чтобы одинаковый вывод давал одинаковый хэш.
   - Строки: `harness/hooks/calls.mjs:86-92`
3. Сколько правок `Write` с содержимым B, A, B, A нужно, чтобы появилась строка `edit-back-and-forth`, и почему?
   - Ответ: четыре: третья и четвёртая правки — два возврата к содержимому двух правок назад, а два возврата считаются третьим повтором, на котором пишется `would-hint`.
   - Строки: `harness/hooks/loop-patterns.mjs:64-69`

## 9. Что нашёл review и что осталось

> VERIFIED; debt: after the first stdin byte, harness/hooks/calls.mjs is bounded only by the 5 s hooks.json timeout (the old timer capped the whole run at 2 s); Claude Code writes the whole payload and closes the pipe, and every other readStdin hook has the same property.
> Consider: a real shell-command loop on Codex is no longer counted (only apply_patch has an exit code) — recorded in the ticket's «Итог». calls.mjs keeps its own INPUT_MS instead of a FIRST_BYTE_MS entry (test/contract/harness-hook-stdin.test.ts:385 pins that map).
> Noted: calls.mjs:182-190 — concurrent hooks of one owner lose records (no lock). calls.mjs:176-179 — a session_id `loops` writes into calls/loops.jsonl. calls.mjs:76-78 — contentHash reads the edited file synchronously (a FIFO hangs it until the 5 s timeout). Low mutants of round 1 still survive (command not in the Bash key, no event filter, no trim, dedupe without agent_id, cwd resolve, apply_patch Delete/Move, notebook_path, MCP object outcome, isCiWait negatives, multi-file apply_patch, loop-log without `t`). The hook's time on Windows is not measured; calls.test.sh section 7 limits (1.5 s, 4.5 s) are checked on the Windows runner by ci-ok only.
> Review depth: high — ticket header (round 2: the verifier alone on the rework diff, decided without the owner)
> Review tokens: 68868

Code: `test/contract/harness-hook-stdin.test.ts:385-385` · key lines: 385

```ts
    expect(Object.keys(FIRST_BYTE_MS).sort()).toEqual(['gh-token-env.mjs', 'session-start.mjs', 'stage-lines.mjs', 'stop.mjs'])
```
