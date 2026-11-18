# 01 — Spike: compaction в Claude Code и Codex, продолжение транскрипта, оборванного посреди вызова

Type: spike
Status: done 2026-11-18T00:54Z
PR: #1972
Blocked by: none
Source: [spec.md](../spec.md), «Ticket-ы», 1; «Решения по реализации» → «Compaction», пункт «Spike сначала (01)»;
«Риски», 8 и 13; [critic 2026-11-14](../../../docs/product/critic/worfy-continuity-2026-11-14.md), возражение 2;
«Решено без владельца», 4

Кто: агент.

Не платформенный Ticket (скрипт spike-а и отчёт, без кода продукта). Глубина ревью — `low`.

**Цена.** Spike зовёт реальную модель: каждый запуск стоит денег. Brief называет предел цены и велит брать самую
дешёвую модель, которая отвечает на вопрос (по умолчанию haiku; дороже — только если haiku не доходит до compaction
или не отвечает), запускать по одному вопросу за раз и записывать цену каждого запуска в «Итог».

## Что происходит

- worfy замечает compaction только по сообщению `compact_boundary`: после него он заново спрашивает заполнение
  контекста (`src/main/vendors/claude/session.ts:535–536`; `isCompactBoundary` — `src/shared/vendors/claude/events.ts:458–462`).
- В `harness/hooks/hooks.json` `SessionStart` стоит без matcher-а (`:4–7`); `PreCompact` и `PostCompact` нет. По типам
  SDK `SessionStartHookInput.source` бывает `'compact'`.
- Дописка к system prompt уже есть: поле `instructions` (`src/main/vendors/claude/options.ts:396`), уходит в конец
  system prompt (`:824`). Переживает ли она compaction, не проверено.
- Codex: worfy не знает, когда Codex сжимает контекст (`src/main/vendors/codex/items.ts:123`), хотя в протоколе есть
  элемент `contextCompaction` (`src/main/vendors/codex/protocol/ts/v2/ThreadItem.ts:144`) и настройка `compact_prompt`
  (`src/main/vendors/codex/protocol/ts/v2/Config.ts:25`). `config` уже уходит в `thread/start`
  (`src/main/vendors/codex/session.ts:961–967`).
- Как Claude Code продолжает транскрипт, оборванный посреди вызова (`tool_use` без `tool_result`), не известно. Ответ
  нужен Ticket-ам 05 и 06 до их начала: они ждут этот Ticket (возражение 2 critic-а).
- Версия SDK закреплена в `package.json:29` (`@anthropic-ai/claude-agent-sdk` 0.3.322).

## Что делаем

1. Скрипт в `scripts/spikes/compaction/` рядом с `scripts/spikes/harness-plugin/probe.ts`: запуск руками, вне CI, на
   версии SDK из `package.json`.
2. Ответы на шесть вопросов spec-а, каждый — с выводом запуска:
   1. приходит ли `SessionStart` с `source: 'compact'` в главной Session и в Subagent-е;
   2. чему следует модель, которая пишет summary: разделу в правилах, `custom_instructions` у `PreCompact`, тексту
      `/compact <text>` или дописке к system prompt;
   3. что лежит в `compact_summary` у `PostCompact`;
   4. переживает ли compaction дописка к system prompt (`instructions`);
   5. Codex: `compact_prompt` на thread через `config` и приходит ли элемент `contextCompaction`;
   6. как Claude Code продолжает транскрипт с `tool_use` без `tool_result`: отвечает ли resume, что видит модель, нужна
      ли worfy заглушка-результат перед сообщением-продолжением.
3. Отчёт — в раздел «Итог» этого Ticket-а: ответ, команда, вывод (без личных данных), цена запуска. По вопросу 2 —
   какой путь брать Ticket-у 10; по вопросу 4 — брать ли дописку Ticket-у 12; по вопросу 6 — что делать Ticket-ам
   05 и 06.

## Готово, когда

- [ ] Скрипт spike-а в `scripts/spikes/compaction/` влит; в CI он не запускается.
- [x] «Итог» отвечает на все шесть вопросов, у каждого ответа — команда и вывод запуска.
  - evidence: commit pass · worfy-continuity/01: spike on compaction hooks and resuming a cut-off tool call · - - · a049e6135719008c8896d3652138132a5b259919
  - evidence: review pass · PR #1972 · - - · 03a780a269275cf95b729161124ce3c47aaa3f09
- [ ] «Итог» называет модель и цену каждого запуска; общая цена — не выше предела из brief-а.
  - evidence: review pass · PR #1972 · - - · 03a780a269275cf95b729161124ce3c47aaa3f09
- [x] «Итог» называет решение для Ticket-ов 05, 06 (вопрос 6), 10 (вопрос 2) и 12 (вопросы 4 и 5).
  - evidence: commit pass · worfy-continuity/01: spike on compaction hooks and resuming a cut-off tool call · - - · a049e6135719008c8896d3652138132a5b259919
  - evidence: review pass · PR #1972 · - - · 03a780a269275cf95b729161124ce3c47aaa3f09
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck` exit 0 · mac - · a049e6135719008c8896d3652138132a5b259919
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44209523373/job/134489741359 · ci - · 03a780a269275cf95b729161124ce3c47aaa3f09

## Где в коде

- `scripts/spikes/compaction/` (новый)

Только читать: `scripts/spikes/harness-plugin/probe.ts`, `harness/hooks/hooks.json`,
`src/main/vendors/claude/options.ts`, `src/main/vendors/claude/session.ts`, `src/main/vendors/codex/session.ts`,
`src/main/vendors/codex/items.ts`, `sdk.d.ts` пакета `@anthropic-ai/claude-agent-sdk`.

## Вне скоупа

- Код продукта и Harness — Ticket-ы 05, 06, 10, 11, 12.

## Итог

Spike проведён 2026-11-18 на SDK 0.3.322 (Claude Code 2.1.322 из пакета SDK), модель `haiku` (Claude Haiku 5.5).
Скрипт — `scripts/spikes/compaction/probe.ts`, plugin-заглушка — `scripts/spikes/compaction/fixture/` (hook пишет
вход каждого события в `hooks.jsonl` и оставляет свою метку от каждого источника инструкций). Команды запускаются из
корня репозитория: `pnpm exec electron scripts/spikes/compaction/probe.ts <scenario>`. Session-ы идут без настроек
пользователя (`settingSources: []`), без connector-ов claude.ai, без auto-memory и без thinking, каждая — в новой
временной папке. Вывод ниже — из `summary.json` прогона, сокращён; личные пути заменены.

Четыре метки в заданиях на summary, у каждой один источник: `RULES-MARK: kestrel-17` — `additionalContext` hook-а
`SessionStart` (так приходят правила Harness), `PRECOMPACT-MARK: osprey-23` — stdout hook-а `PreCompact`,
`SLASH-MARK: heron-31` — текст `/compact <text>`, `SYSPROMPT-MARK: falcon-47` — дописка к system prompt
(`systemPrompt.append`, то же, что `instructions` worfy).

### 1. `SessionStart` с `source: 'compact'` — главная Session и Subagent

**Главная Session: да.** Порядок: `PreCompact` → `SessionStart` (`source: compact`) → `PostCompact`. Его
`additionalContext` уходит в первый запрос к модели после compaction.

`probe.ts manual`:

```
{'event': 'SessionStart', 'source': 'startup'}
{'event': 'PreCompact', 'trigger': 'manual', 'custom_instructions': 'Include the line SLASH-MARK: heron-31 in the summary.'}
{'event': 'SessionStart', 'source': 'compact'}
{'event': 'PostCompact', 'trigger': 'manual', 'summary_marks': ['rules', 'precompact', 'slash', 'system_prompt']}
request_after_compaction = {'compacted': True, 'system_prompt_append_before': True, 'system_prompt_append_after': True,
  'compact_rules_sent_after': True, 'summary_sent_after': True}
```

`probe.ts auto` (окно compaction 100000, порог 5 %): то же с `trigger: 'auto'`, `compact_rules_sent_after: True`.

**Subagent: да, но hook не узнаёт, что это Subagent.** Compaction Subagent-а запускает `PreCompact`, `SessionStart`
(`source: compact`) и `PostCompact`; `additionalContext` попадает в контекст самого Subagent-а (его транскрипт
`subagents/agent-*.jsonl`). Во входе hook-а при этом нет `agent_id` и `agent_type`, а `transcript_path` указывает на
транскрипт главной Session. У `SubagentStart` и `PreToolUse` того же Subagent-а `agent_id` есть.

`probe.ts subagent` (Subagent `spike-reader` трижды читает файл в 600 строк):

```
{'event': 'SubagentStart', 'in_subagent': True, 'agent_type': 'spike-reader', 'transcript': 'main'}
{'event': 'PreToolUse', 'in_subagent': True, 'agent_type': 'spike-reader', 'transcript': 'main'}
{'event': 'PreCompact', 'transcript': 'main', 'trigger': 'auto'}
{'event': 'SessionStart', 'transcript': 'main', 'source': 'compact'}
{'event': 'PostCompact', 'transcript': 'main', 'trigger': 'auto', 'summary_marks': ['precompact']}
...
main_compact_boundaries = []
subagent boundary agent-aece9b323a472f5f3.jsonl auto 21503 9559
subagent boundary agent-aece9b323a472f5f3.jsonl auto 23280 1530
subagent_request_after_compaction = [{'compacted': True, 'system_prompt_append_before': False,
  'system_prompt_append_after': False, 'compact_rules_sent_after': True, 'summary_sent_after': True}]
```

`in_subagent` — есть ли `agent_id` во входе hook-а; `transcript` — ведёт ли `transcript_path` в `subagents/`.

### 2. Чему следует модель, которая пишет summary

**Всем четырём источникам.** При `/compact <text>` в summary все четыре метки; при auto-compaction (текста
`/compact` нет) — три: правила, `PreCompact`, дописка к system prompt. В Subagent-е — только метка `PreCompact`:
правил главной Session и её дописки к system prompt у Subagent-а нет.

```
manual:   PostCompact summary_marks = ['rules', 'precompact', 'slash', 'system_prompt']
auto:     PostCompact summary_marks = ['rules', 'precompact', 'system_prompt']
subagent: PostCompact summary_marks = ['precompact']   (первая compaction Subagent-а)
```

Как это устроено (код Claude Code 2.1.322, функция `executePreCompactHooks`): stdout каждого успешного hook-а
`PreCompact` — простой текст, не JSON — склеивается с текстом `/compact` и уходит в задание на summary как
`customInstructions`; вход `PreCompact` получает текст `/compact` в `custom_instructions` (выше). Предел stdout —
10000 символов, дальше обрезка. Hook `PreCompact` может сработать несколько раз на одну compaction: в прогоне `auto`
— три запуска `PreCompact` на одну границу (Claude Code повторял попытку), поэтому hook должен быть быстрым и без
побочных действий.

### 3. Что лежит в `compact_summary` у `PostCompact`

Весь ответ модели, которая писала summary: блок `<analysis>…</analysis>`, затем `<summary>` из девяти пунктов —
Primary Request and Intent, Key Technical Concepts, Files and Code Sections, Errors and fixes, Problem Solving, All
user messages, Pending Tasks, Current Work, Optional Next Step, — и строки, которых просили инструкции. Рядом во
входе — `trigger` (`manual` / `auto`). Модель после compaction видит этот текст как сообщение «This session is being
continued from a previous conversation…» (`summary_sent_after: True`). Вывод hook-а `PostCompact` модели не уходит:
Claude Code показывает его только человеку (`userDisplayMessage` в коде).

Отрывок `compact_summary` из `probe.ts manual`:

```
<summary>
1. Primary Request and Intent:
   The user asked me to remember that the deploy target is staging-east and to reply "ok". ...
6. All user messages:
   - "Keep this fact in mind for later: the deploy target is staging-east. Reply with: ok"
   - "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. ..." (compaction summary request, including
     the instruction to include SLASH-MARK: heron-31 and PRECOMPACT-MARK: osprey-23)
...
Required marker lines:
SYSPROMPT-MARK: falcon-47
RULES-MARK: kestrel-17
SLASH-MARK: heron-31
PRECOMPACT-MARK: osprey-23
</summary>
```

### 4. Переживает ли compaction дописка к system prompt (`instructions`)

**Да, в главной Session.** Текст дописки стоит в `system` первого запроса после compaction (запись запроса в
транскрипте, `system_prompt_append_after: True`) и при `/compact`, и при auto-compaction. Модель после compaction
отвечает словом из дописки:

```
manual: answer_after_compaction = 1) falcon-47 / 2) staging-east / 3) kestrel-17
auto:   answer_after_compaction = 1) falcon-47 / 2) staging-east / 3) kestrel-17
```

Subagent-у дописка главной Session не достаётся ни до, ни после compaction (`system_prompt_append_before: False`).

### 5. Codex: `compact_prompt` и элемент `contextCompaction` — по документации, не проверено запуском

Brief запрещает запускать настоящий Codex, поэтому ответ — по типам протокола в `src/main/vendors/codex/protocol/ts`,
коду worfy и документации Codex (config reference и hooks на learn.chatgpt.com, прочитаны 2026-11-18).

- `compact_prompt` — ключ `Config` (`protocol/ts/v2/Config.ts:25`), в документации: «Inline override for the history
  compaction prompt». Это **замена** prompt-а compaction, а не дописка. Есть ещё `experimental_compact_prompt_file`
  (путь к файлу) и `model_auto_compact_token_limit`.
- worfy уже передаёт `config` и в `thread/start`, и в `thread/resume` (`src/main/vendors/codex/session.ts:966–972`),
  поэтому `config: { compact_prompt: … }` на thread — ожидаемо рабочий путь. Запуском не проверено.
- Элемент `{ type: 'contextCompaction', id }` есть в `ThreadItem` (`protocol/ts/v2/ThreadItem.ts:144`); старое
  уведомление `thread/compacted` (`threadId`, `turnId`) помечено deprecated в пользу этого элемента. Ручная
  compaction — запрос `thread/compact/start` (`threadId`). Чисел токенов до и после в элементе нет. worfy этот элемент
  сейчас не разбирает (`src/main/vendors/codex/items.ts:123`).
- Hook-и Codex: у `SessionStart` есть matcher `compact` (а также `startup`, `resume`, `clear`, `fork`), его
  `additionalContext` уходит модели как developer context. `PreCompact` и `PostCompact` получают только `turn_id` и
  `trigger`; stdout `PreCompact` Codex игнорирует, hook может лишь остановить compaction (`continue: false`).
  Инструкции summary у Codex идут только через `compact_prompt`.

### 6. Транскрипт, оборванный посреди вызова (`tool_use` без `tool_result`)

**После SIGKILL (падение): resume работает, заглушка-результат worfy не нужна.** Claude Code при resume сам дописывает
в транскрипт `tool_result` с `is_error: true` и строку ассистента «No response requested.», потом идёт сообщение
worfy. Session id тот же, ошибок нет. Модель видит вызов как прерванный, с неизвестным исходом, и сама его не
повторяет, но следующим шагом предлагает повторить команду. Команда после SIGKILL продолжает идти без Claude Code:
`sleep 20` был жив после смерти процесса.

`probe.ts cutoff` (по умолчанию `--signal SIGKILL`; команда `echo CUTOFF-START && sleep 20 && echo CUTOFF-END`,
процесс убит через 3 с после `PreToolUse`):

```
exit: {code: null, signal: SIGKILL}
command_still_running_after_stop: true
before_resume.unanswered_calls: ['Bash toolu_013iGyvjj8nByoiuK43JVS7t']
resume.same_session_id: true
resume.rows_added[0]: user tool_result tool_use_id=toolu_013iGyvjj8nByoiuK43JVS7t is_error=true
  "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown.
   Check whether it took effect before relying on it or running it again.]"
resume.rows_added[1]: assistant "No response requested."
resume.answer: "1) The last Bash call returned only: "[Tool call interrupted: ...]". No CUTOFF-START or CUTOFF-END
  output appeared. 2) Unknown. ... 3) I would rerun `echo CUTOFF-START && sleep 20 && echo CUTOFF-END` ..."
resume.unanswered_calls_after: []
```

**После SIGTERM (мягкий выход):** Claude Code сам убивает команду и записывает настоящий `tool_result` с её выводом до
этого места; вызова без результата нет, resume ничего не дописывает.

`probe.ts cutoff --signal SIGTERM`:

```
exit: {code: 143, signal: null}
before_resume.unanswered_calls: []
before_resume.tail: user tool_result is_error=true "Exit code 137\nCUTOFF-START"
resume.answer: "1) Exit code 137, with stdout `CUTOFF-START` and no `CUTOFF-END`. 2) No. It was killed during the
  `sleep 20` ..."
```

### Решения для Ticket-ов

- **05 и 06 (вопрос 6).** Заглушку `tool_result` перед сообщением-продолжением worfy не пишет: после resume Claude
  Code ставит её сам. Вызов без результата Ticket 16 ищет в транскрипте **до** resume: после resume у вызова уже есть
  результат с текстом «Tool call interrupted: the session ended before this call's result was recorded» — его тоже
  считать вызовом без результата. `restartText` прямо просит проверить, что сделала команда, прежде чем повторять:
  модель сама предлагает повтор, а команда после падения могла дойти до конца без Claude Code. Мягкий выход (SIGTERM,
  Ticket 04) оставляет в транскрипте настоящий результат с кодом 137 — такой вызов оборван, но не «без результата».
- **10 (вопрос 2).** Путь — hook `PreCompact`, который печатает `harness/hooks/rules/compaction.md` для своей роли:
  он работает при `/compact` и при auto-compaction, в главной Session и в Subagent-е, и единственный из проверенных
  доходит до summary Subagent-а. Ограничения: простой текст, до 10000 символов, hook может сработать несколько раз за
  одну compaction. Строка в правилах (`additionalContext` `SessionStart`) работает в главной Session, но Subagent-у не
  передаётся. Codex stdout `PreCompact` не читает: туда те же инструкции идут через `compact_prompt` (Ticket 12).
- **11 (вопрос 1).** `SessionStart` с matcher-ом `compact` срабатывает и в Subagent-е, и его `additionalContext`
  доходит до Subagent-а. Но по входу hook-а implementer (Subagent) неотличим от Orchestrator-а: нет `agent_id`, а
  `transcript_path` — главной Session. Роль Ticket 11 берёт из другого: из `cwd` и ветки (worktree implementer-а) или
  из окружения. Совпадает ли `cwd` во входе hook-а с worktree Subagent-а, этот spike не проверял. Запасная строка в
  `common.md` (перечитать Ticket и `git status`) нужна, как и задумано.
- **12 (вопросы 4 и 5).** Дописку к system prompt (`instructions`) брать: Epic и Ticket-ы Wave в ней переживают
  compaction главной Session. Subagent-ы её не видят. Codex — `compact_prompt` в `config` thread-а при
  `thread/start` и `thread/resume`. Это полная замена prompt-а compaction, поэтому в нём весь prompt, а не только
  разделы Harness. Строку «Context compacted» у Codex давать по элементу `contextCompaction`. Чисел токенов в нём нет:
  брать из `thread/tokenUsage/updated` или показывать строку без чисел. Проверить запуском до merge Ticket-а 12.

### Цена

Предела цены в brief-е нет; правило — самая дешёвая модель (haiku) и по одному вопросу за прогон. Цена — `total_cost_usd`
последнего result-сообщения Session; у убитой Session result-сообщения нет, её цена оценена по usage (≈0,0005 $).

| Прогон | Что | Цена, $ |
|---|---|---|
| `manual`, первый | неудачная настройка: adaptive thinking haiku дошёл до предела 128K токенов на «Reply with: ok», после compaction в запрос пришли 790 tools connector-ов claude.ai (запрос 714K токенов) | 1,4144 |
| `manual` | вопросы 1–4 | 0,0017 |
| `auto` ×3 | два прогона без compaction (порог считался от окна 980K), третий с окном 100000 | 0,0021 + 0,0011 + 0,0024 |
| `subagent` ×3 | второй без compaction (три `Read` разом — Claude Code пропускает compaction без прежних ответов) | 0,0089 + 0,0052 + 0,0095 |
| `cutoff` ×3 | SIGKILL, SIGTERM, SIGKILL с проверкой команды | 0,0003 + 0,0006 + 0,0003 и ≈0,0015 за три убитые Session |
| **Всего** | | **≈1,45** |

Из 1,45 $ на первый прогон ушло 1,41 $. После него скрипт выключает thinking, connector-ы claude.ai
(`ENABLE_CLAUDEAI_MCP_SERVERS=false`) и auto-memory. Каждый следующий прогон стоил меньше 0,01 $.

### Транскрипты

Прогоны оставили 11 папок `~/.claude/projects/-Users-<…>-worfy-compaction-probe-<id>-<scenario>/` (по одной на прогон,
у `subagent` — ещё `subagents/agent-*.jsonl`). В папке первого `manual` есть ещё `memory/`: туда писала auto-memory
до того, как скрипт её выключил. Spike их не удалял.
