# Code story — worfy-continuity 10: Harness: инструкции summary по ролям в `compaction.md` и запасная строка в `common.md`

Kind: pr · Epic: worfy-continuity · Ticket: 10 · PR: - · Language: ru

## 1. Что было не так

Модель, которая пишет summary при compaction, не знает, что сохранить: цель, Ticket, пункты «Готово, когда» и решения
теряются. Правила роли вставляет `harness/hooks/inject-rules.mjs`, но места для инструкций summary в
`harness/hooks/rules/orchestrator.md` нет: он занимает 9644 знака при пределе одного куска в 10 000. Spike 01 (вопрос 2)
показал путь: stdout hook-а `PreCompact` простым текстом уходит в задание на summary при `/compact` и при
auto-compaction, в главной Session и в Subagent-е, и обрезается после 10 000 символов.

- Требование: [Что происходит](../issues/10-инструкции-summary-harness.md#что-происходит)

## 2. Hook `PreCompact` в `hooks.json`

Code: `harness/hooks/hooks.json:82-92` · key lines: 82, 87

```json
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.mjs\" compaction",
            "timeout": 10
          }
        ]
      }
    ],
```

- Что делает: на каждое событие `PreCompact` (без matcher-а, значит и `manual`, и `auto`) Claude Code запускает
  `inject-rules.mjs` с куском `compaction`.
- Почему здесь: «Итог» spike-а 01, «Решения для Ticket-ов», пункт 10: путь — hook `PreCompact`, единственный из
  проверенных доходит до summary Subagent-а. Строка в правилах `SessionStart` Subagent-у не передаётся.
- Без него: инструкции summary не доходят ни до одной compaction.
- Требование: [Что делаем, пункт 3](../issues/10-инструкции-summary-harness.md#что-делаем)
- Риски и пробелы test-ов: spike видел три запуска `PreCompact` на одну auto-compaction; hook только читает файл,
  поэтому повтор безвреден, но проверен только запуском spike-а, не test-ом. Codex запускает тот же `hooks.json`:
  новый hook — ещё один, который пользователь Codex одобряет в `/hooks` (после любого обновления Harness их всё равно
  одобряют заново).

## 3. На `PreCompact` — простой текст, на Codex — ничего

Code: `harness/hooks/inject-rules.mjs:95-100` · key lines: 97, 98

```js
    // split/join replaces the placeholder literally: no regex, no replacement patterns ($&) in the path.
    let additionalContext = text.replace(/\n+$/, "").split(TOKEN).join(root)
    if (event.name === PRE_COMPACT) {
        if (!isCodexInput(hook)) process.stdout.write(additionalContext + "\n")
        return
    }
```

- Что делает: на `PreCompact` печатает текст куска как есть, без JSON `hookSpecificOutput`; если вход пришёл от Codex
  (`turn_id` во входе, `codex-input.mjs`), не печатает ничего.
- Почему здесь: spike 01, вопрос 2: stdout `PreCompact` — простой текст, который склеивается с текстом `/compact`; JSON
  ушёл бы в задание на summary буквально. Codex stdout `PreCompact` не читает, его инструкции идут через
  `compact_prompt` (Ticket 12); почему Codex-у не печатать вовсе, а не печатать впустую, — не записано.
- Без него: модель summary получила бы строку JSON вместо текста правил.
- Требование: [Что делаем, пункт 3](../issues/10-инструкции-summary-harness.md#что-делаем)
- Риски и пробелы test-ов: test проверяет вывод hook-а, а не то, что Claude Code кладёт его в задание на summary;
  это показал только spike. Ограничение 10 000 символов кусок держит с запасом (2693 знака), test меряет его с длинным
  корнем plugin-а.

## 4. Один кусок для всех ролей

Code: `harness/hooks/rules/compaction.md:27-40` · key lines: 27, 30, 33, 36, 37

```md
Put the facts of the role into those sections. The role follows from the conversation: its first
instructions and the task it was given.

**Orchestrator** — a main Session that runs an epic: the epic, the wave number and each ticket of the
wave with its state; every PR in work with its number, branch, CI state and review verdict; the agents
still running, each with its name, ticket and worktree; every decision taken without the owner, one
line each, as in the decision log (`decisions.tsv`, skill `worfy:epic-wave`); the questions waiting for
the owner.

**Implementer** — an agent that ships one ticket (`worfy:implementer`): the ticket file, the worktree
path, the branch and the base commit; every item of the ticket's done section (`tickets.done_section`
of the profile), each with its mark — done with its evidence, not done, or not verified; the PR number
when there is one; the commands run so far with their exit codes, and what the change removed from
existing behaviour.
```

- Что делает: перед этим кусок задаёт семь разделов summary (Intent, Essential facts, Completed work, Files touched,
  Errors, Pending work, Next action); здесь — что сохраняет каждая роль. Роль выбирает модель summary по разговору.
- Почему здесь: разделы и факты ролей — из spec («Решения по реализации» → «Compaction», «Инструкции summary (10)»).
  Один текст на все роли — потому что spike 01 показал: во входе `PreCompact` Subagent-а нет `agent_id`, а
  `transcript_path` ведёт в главную Session, и hook не может выбрать кусок по роли.
- Без него: summary Orchestrator-а и implementer-а пишется по общему шаблону Claude Code, где нет Wave, решений без
  владельца и отметок пунктов «Готово, когда».
- Требование: [Что делаем, пункты 1–2](../issues/10-инструкции-summary-harness.md#что-делаем)
- Риски и пробелы test-ов: следует ли модель этим инструкциям, test не меряет — это eval 13. Test проверяет, что
  разделы стоят по порядку и что названы факты каждой роли.

## 5. Запасная строка в `common.md`

Code: `harness/hooks/rules/common.md:75-77` · key lines: 75, 76

```md
- After a compaction (the conversation replaced by its summary), re-read your ticket (an orchestrator:
  `${CLAUDE_PLUGIN_ROOT}/bin/epic-status` of its epic) and run `git status` before the next step. The
  summary may have dropped or bent a fact; the files have not.
```

- Что делает: каждая Session и каждый Subagent получают правило: после compaction перечитать свой Ticket (Orchestrator —
  `epic-status` своего Epic-а) и `git status`, прежде чем идти дальше.
- Почему здесь: spec, «Hook ветки `compact` (11)»: строка — на случай, если для Subagent-а hook возврата состояния не
  сработает; `common.md` — единственный кусок, который доходит и до Subagent-а (`SubagentStart`).
- Без него: Subagent после compaction идёт дальше по summary, даже если в нём потерян Ticket.
- Требование: [Что делаем, пункт 4](../issues/10-инструкции-summary-harness.md#что-делаем)
- Риски и пробелы test-ов: на Codex `common` с полным слотом правил пользователя уже выше предела Codex (известный
  пробел из `harness/README.md`); строка добавляет около 60 токенов к 1493 у `common` без правил пользователя.

## 6. Что сознательно не меняли

- `harness/hooks/rules/orchestrator.md` — места нет; инструкции summary в нём не повторяются.
- Возврат состояния после compaction (`SessionStart` с `source: compact`) — Ticket 11; `WORFY_EPIC` и
  `compact_prompt` Codex — Ticket 12.
- `harness/README.md` (таблица `hooks/`) не правился: его нет в «Где в коде».
- Русский перевод `docs/features/ru/skills-agents-and-hooks.md` — Ticket 14.

## 7. Как проверено

- `bash harness/hooks/tests/rules-hooks.test.sh` — сначала exit 1 (30 провалов: нет куска, hook-а, строки), после
  правки exit 0, 326 проверок.
- Полный `pnpm test` нашёл ещё три места, которые правка задела, и они исправлены: `harness/evals/lib/coverage.json`
  требует причину для нового файла правил; `harness/bin/tests/plugin-neutral.test.sh` не пускает в plugin номера
  Ticket-ов worfy; fixture `harness/bin/tests/start-context.test.sh` копирует `inject-rules.mjs` без соседей и теперь
  копирует и `codex-input.mjs`, который он импортирует. После правки `plugin-neutral.test.sh` и
  `start-context.test.sh` — exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` под временным HOME и gate fast — коды выхода в отчёте implementer-а.

## Проверить себя

1. Почему один кусок `compaction.md` на все роли, а не отдельный кусок на Orchestrator и на implementer?
   - Строки: `harness/hooks/rules/compaction.md:27-28`
   - Ответ: hook `PreCompact` не отличает Subagent от главной Session — во входе нет `agent_id`; роль выбирает модель
     summary по своему разговору.
2. Что увидела бы модель summary, если бы на `PreCompact` hook печатал тот же JSON, что на `SessionStart`?
   - Строки: `harness/hooks/inject-rules.mjs:97-98`
   - Ответ: строку JSON с экранированным текстом: Claude Code берёт stdout `PreCompact` как простой текст и
     склеивает его с текстом `/compact`.
