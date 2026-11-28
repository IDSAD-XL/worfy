# Code story — worfy-harness-guarantees 06: guard: защищённые области в любом режиме

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

Hard deny Approval policy судит только запросы разрешения, а в `bypassPermissions` и в Codex Full access их нет. guard
отказывал уничтоженную работу, pipe без exit code, следы Silent mode и пути проверок, но запись в `~/.claude`, `~/.codex`,
секреты home, данные worfy и настройки ОС проходила: `echo x > ~/.claude/settings.json` в `bypassPermissions` —
`allow` (первый красный case `guard-areas.test.sh`).

- Требование: [Что происходит](../issues/06-guard-защищённые-области-в-любом-режиме.md#что-происходит)

## 2. Один список областей и что в нём открыто

Code: `harness/lib/protected-areas.cjs:125-136` · key lines: 128, 129, 133

```js
function openPlaces(areas, { env = process.env, platform = process.platform } = {}) {
    const out = []
    for (const a of areas) {
        if (a.id === "claude-home") out.push(join(a.path, "projects/*/memory"), join(a.path, "plans"))
        if (a.id === "worfy-data") out.push(join(a.path, "*/cards"))
    }
    // The Session's own temporary folder, when it lies below an area: worfy gives an unattended Session
    // <worfy data>/autopilot-tmp/<run> as TMPDIR (run-approval.ts, runTempsDir).
    const tmp = keyOf(env.TMPDIR, platform)
    if (tmp !== null && areas.some((a) => { const k = keyOf(a.path, platform); return k !== null && k !== tmp && within(tmp, k) })) out.push(tmp)
    return out.map((p) => keyOf(p, platform)).filter(Boolean)
}
```

- Что делает: внутри областей остаются открытыми память и планы Claude Code, папки Card-ов и `TMPDIR` Session-а, если
  он лежит в области.
- Почему здесь: Ticket велит исключения «память Claude Code, файлы Session по spike-у 01, папка Card-ов»; spike 01, пункт 7,
  назвал `plans/` и `projects/*/memory/`. `TMPDIR` — по diff-у: unattended Session получает `<данные worfy>/autopilot-tmp/<run>`
  (`runTempsDir`), и без исключения guard отказал бы каждому временному файлу Autopilot-а. Модуль — вне trail-а: contract
  test читает тот же список, а `guard.mjs` импортировать нельзя (скрипт читает stdin).
- Без него: Orchestrator не записал бы память, агент — Card, Autopilot — временный файл; case-ы «open: …» в
  `guard-areas.test.sh` красные.
- Требование: [Что строить](../issues/06-guard-защищённые-области-в-любом-режиме.md#что-строить)
- Риски и пробелы test-ов: Card-ы открыты в папке любого Project-а, не только своего: guard не знает Project Session-а.
  Память Claude Code открыта — риск записан в spec-е.

## 3. Кому отказ, кому вопрос

Code: `harness/hooks/guard.mjs:1530-1537` · key lines: 1535, 1536

```js
let asked = null
const refuseArea = (what, rule) => {
    const reason =
        `${what}: the guard of the Harness refuses it in any permission mode. ${AREA_HINTS[rule] || HOME_HINT} ` +
        "Name the change and the reason in your report; reading there stays allowed."
    if (codex || process.env.WORFY_UNATTENDED === "1") deny(reason, rule)
    asked ??= `${reason} A person is at this Session, so it is asked: allow it only if you asked for this change.`
}
```

- Что делает: Session без человека (`WORFY_UNATTENDED=1`) и любая Session Codex получают отказ; ручная Session Claude
  Code — `ask` с той же причиной.
- Почему здесь: Q2 (в) владельца; spike 01, пункт 4: `ask` в `bypassPermissions` спрашивает человека, а в `claude -p` без
  permission prompt tool сам становится отказом. Codex — по fixture-у парсера: `ask` там «invalid pre-tool-use JSON
  output», hook падает и вызов проходит, поэтому на Codex — отказ (Q2 (а)).
- Без него: либо ручные Session-ы получали бы отказ без вопроса, либо Codex и Autopilot проходили бы по `ask`; case-ы
  раздела «who is asked» красные.
- Требование: [Что строить](../spec.md#вопросы-владельцу)
- Риски и пробелы test-ов: настоящий диалог `ask` в worfy не проверен: test видит только ответ hook-а.

## 4. Раздел 5: цели записи, `.git`, команды

Code: `harness/hooks/guard.mjs:1607-1627` · key lines: 1614, 1615, 1617, 1624, 1626

```js
function protectedSection() {
    const platform = process.platform
    const areas = protectedAreas({ env: process.env, platform, homedir: os.homedir(), harnessHome: harnessHomeOf(cwdOf(), process.env) })
    const open = openPlaces(areas, { env: process.env, platform })
    const what = (file) => (bash ? `This command writes or removes ${shown(file)}` : `${tool} of ${shown(file)}`)
    const targets = bash ? shellTargets(cmd, { mkdir: true }) : callTargets()
    for (const t of targets) {
        for (const p of [t.abs, realTarget(t.abs).real]) {
            const area = areaOf(p, areas, open, { platform, folder: t.folder === true })
            if (area) return refuseArea(`${what(t.abs)}, in ${shown(area.path)}, a protected area (${area.id})`, area.id)
            if (gitFileOf(p, { platform })) return refuseArea(`${what(t.abs)}, a hook or the config of a git repository`, "git-files")
        }
    }
    if (!bash) return
    const flat = flattenHeredocs(cmd).flat
    for (const words of lex(flat)) {
        const prog = osSettingsOf(words)
        if (prog) return refuseArea(`This command runs \`${prog}\`, which changes the settings of the OS or of an app`, "os-settings")
    }
    if (runsDownload(flat)) return refuseArea("This command runs what curl or wget downloads", "run-download")
}
```

- Что делает: каждая цель записи Bash (с `mkdir`), Edit, Write, MultiEdit, NotebookEdit и `apply_patch` сверяется с
  областями как названа и через ссылки; затем `.git/hooks/`, `.git/config`; для Bash — `os-settings` и `run-download`.
- Почему здесь: Ticket называет новый раздел после раздела Ticket-а 03 в том же файле; цели записи берутся теми же
  `shellTargets` и `callTargets`, что у раздела 4.
- Без него: ни одного отказа по областям; mutation testing: снятие любой проверки краснит от 1 до 27 case-ов.
- Требование: [Что строить](../issues/06-guard-защищённые-области-в-любом-режиме.md#что-строить)
- Риски и пробелы test-ов: guard лексический — `node -e "…writeFileSync…"` и путь за непрочитанной переменной проходят
  (spec, «Риски»). Tool PowerShell Claude Code на Windows matcher не видит.

## 5. Сбой пропускает, `ask` ждёт раздел 3

Code: `harness/hooks/guard.mjs:1630-1641` · key lines: 1632, 1635, 1637, 1638

```js
// as bad as one that misses.
try {
    protectedSection()
} catch {}

if (bash) silentCheck()

if (asked) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: asked } }))
    process.exit(0)
}
ok()
```

- Что делает: исключение внутри раздела пропускает вызов; `ask` пишется только после проверки следов Silent mode, так что
  её отказ сильнее вопроса.
- Почему здесь: spec, «Риски»: «Сбой guard открывает проход»; брифа: ложный отказ на обычной работе так же плох, как
  пропуск. Порядок `ask` после раздела 3 — по diff-у: иначе разрешённый человеком вызов прошёл бы мимо проверки следов.
- Без него: исключение в разборе пути ломало бы любой вызов; test «a commit with workflow traces and a protected write»
  красный.
- Требование: [Риски](../spec.md#риски)
- Риски и пробелы test-ов: сбой внутри раздела отдельным test-ом не вызывается.

## 6. Переменные guard-а в окружении Session-а

Code: `src/main/vendors/session.ts:27-32` · key lines: 29, 30

```ts
export function guardVariables(unattended: boolean, env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  return {
    ...(unattended ? { [UNATTENDED_VARIABLE]: '1' } : {}),
    ...(env.WORFY_DATA_DIR ? { [GUARD_DATA_VARIABLE]: dataRoot(env) } : {}),
  }
}
```

- Что делает: unattended Session получает `WORFY_UNATTENDED=1`; Session worfy с перенесённой папкой данных
  (`WORFY_DATA_DIR`) — `WORFY_GUARD_DATA_DIR`. Зовут её `sessionEnv` (Claude) и `open` (Codex).
- Почему здесь: Ticket: признак Session без человека и путь данных — из окружения, которое worfy задаёт Session-у
  (`options.ts`, `session.ts` Codex). Общий helper — вне trail-а, чтобы оба Vendor-а задавали одно и то же. Без
  `WORFY_DATA_DIR` переменной нет: guard знает default-ы платформы, а окружение ручной Session остаётся прежним объектом.
- Без него: unattended Session Claude получала бы `ask`, на который некому ответить; test-ы `agent-options.test.ts` и
  `codex-session.test.ts` красные.
- Требование: [Что строить](../issues/06-guard-защищённые-области-в-любом-режиме.md#что-строить)
- Риски и пробелы test-ов: Session, запущенная не worfy (терминал), считается ручной — по Q2 (в) это и нужно.

## 7. Одна таблица, записанные расхождения

Code: `test/contract/guard-policy-parity.test.ts:211-225` · key lines: 215, 222, 223

```ts
    // the rows where the two differ on purpose
    {
      command: 'git push --force-with-lease origin worfy-demo/03',
      hard: null,
      differs: { policy: 'git-force-push', guard: null, why: 'the policy takes --force-with-lease for a force push (shell.ts); the guard lets a lease into the branch of a PR, as the skill has it after a rebase (ticket 05)' },
    },
    {
      command: 'curl -s https://example.test/api | jq .name',
      hard: null,
      differs: {
        policy: 'run-download',
        guard: null,
        why: 'the policy takes any program outside the table of its parser (jq) for one that may run what it reads; the guard, on every call of every Session, refuses only a shell or an interpreter that runs its input, so a download read by jq stays ordinary work',
      },
    },
```

- Что делает: таблица команд идёт через `judge` (парсер `shell.ts`) и через процесс guard-а; строка с `differs` ждёт
  именно названного расхождения.
- Почему здесь: Ticket: «одна таблица команд … даёт одно hard-решение; одно расхождение записано» — lease. Ещё два — по
  diff-у: guard не отказывает чтению (spec, «Решение», 3), и `curl … | jq` политика считает `run-download`, а guard — нет.
- Без него: новое hard-правило или область одной стороны не заметили бы; test сверяет и области, и id с `roots.ts` и
  `HARD_HINTS`.
- Требование: [Готово, когда](../issues/06-guard-защищённые-области-в-любом-режиме.md#готово-когда)
- Риски и пробелы test-ов: расхождений три, а не одно, как в Ticket-е; правила git push и веток оставлены политике и
  Ticket-у 05 списком в test-е.

## 8. Как проверено

- `bash harness/hooks/tests/guard-areas.test.sh` — exit 1 на старом guard-е (126 из 170 красные), exit 0 после (172 из 172).
- `guard-verification`, `guard-silent`, `rules-hooks`, `calls`, `session-hooks` — exit 0.
- `test/contract/guard-policy-parity.test.ts`, `test/contract/harness-guarantees.test.ts` (case-ы 7 и 8 на binary SDK со
  stand-in-ом), `test/contract/codex-session.test.ts` — exit 0.
- Mutation testing через `HOOKS_DIR`: 13 мутаций, каждая краснит хотя бы один case.
- `pnpm lint`, `pnpm typecheck` — exit 0. `pnpm test` на этом Mac — exit 1: красные только test-ы file watcher-а
  (`docs`, `cards-watch-edits`, `workflow-reader`, `workflow-read-from-main` и др.; известная проблема `fseventsd`),
  `cards-watch-edits` красный и в одиночку, хотя зовёт только `fs.watch`. Остальное и Windows с Git Bash решает CI.

## Проверить себя

1. Почему ручная Session Codex получает отказ, а ручная Session Claude Code — вопрос?
   - Ответ: Codex не принимает `ask` от hook-а — hook считается упавшим, и вызов прошёл бы; Claude Code спрашивает человека.
   - Строки: `harness/hooks/guard.mjs:1535-1536`
2. Почему временный файл Autopilot-а в `$TMPDIR` не отказан, хотя лежит в папке данных worfy?
   - Ответ: `TMPDIR` Session-а внутри области — открытое место; unattended Session получает его в `autopilot-tmp`.
   - Строки: `harness/lib/protected-areas.cjs:131-133`
3. Почему `ask` выдаётся только в конце скрипта?
   - Ответ: отказ раздела 3 (следы Silent mode) должен победить вопрос, иначе разрешённый вызов прошёл бы без проверки.
   - Строки: `harness/hooks/guard.mjs:1635-1640`
