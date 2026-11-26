# 10 — Session Assistant-а: cwd вне Project-ов, третий вид Session в Harness, только tools `worfy-app`, файл памяти

Type: task
Status: done 2026-11-26T03:26Z
PR: #2247
Branch: worfy-assistant/10
Blocked by: 06, 09
Source: [spec.md](../spec.md), «Ticket-ы», строка 10; «Решение», слой 2; «Решения владельца», 2 и 11; «Решения по
реализации» → «Session Assistant-а»; «Границы», 1; «Решения по test-ам», В; «Волны», Wave 4

Кто: агент.

## Что строить

1. **Где работает.** Claude Code; cwd — папка данных worfy вне всех Project-ов, поэтому `CLAUDE.md` и hooks Project-ов
   не грузятся. На Canvas Project-ов её нет.
2. **Правила.** Третий вид Session для Harness: `WORFY_SESSION_KIND` с новым значением и свой файл правил.
3. **Tools.** Только tools `worfy-app` (Ticket 09); Bash, запись файлов и сеть запрещены. Образец — Session черновика
   профиля.
4. **Пробуждение.** Новая Session на каждое пробуждение (решение о пробуждении — Ticket 06).
5. **Память — файл состояния:** обязанности, открытые предложения, обязательства, правила из оценок, ответы пользователя.
6. **Модели.** Рассуждает сильная модель. Haiku 5.5 только сортирует текст внешних источников (Ticket 11).

## Где в коде

- `WORFY_SESSION_KIND` — `src/main/vendors/claude/options.ts` (`SESSION_KIND_VARIABLE`, значение `product`).
- Правила по виду Session — `harness/hooks/inject-rules.mjs`; правила Product Session — `harness/hooks/rules/product.md`.
- Session черновика профиля — `src/main/projects/connect.ts`.
- Запрет tools у одноразового вызова — `src/main/vendors/claude/one-shot.ts`.

## Решения

- Session Claude Code на каждое пробуждение, вне всех Project-ов, со своими правилами Harness и одним MCP-сервером
  `worfy-app`; память — файл состояния (spec, «Решение», слой 2; решение 11 — вариант c).
- Haiku 5.5 вместо Haiku 4.5 только для сортировки (решение 2; spec, «Session Assistant-а», «Модели»).
- Граница 1: у Assistant-а только tools `worfy-app`, нет Bash, записи файлов и сети (spec, «Границы»).

## Test-ы

Стык В (spec, «Решения по test-ам»): отдельный unit test — у Session Assistant-а нет Bash. Сценарий e2e с fake агентом
(`WORFY_AGENT=fake`) — Ticket-ы 14–16.

## Готово, когда

- [ ] Session Assistant-а стартует с cwd в папке данных worfy вне всех Project-ов; `CLAUDE.md` и hooks Project-ов не
      грузятся; на Canvas Project-ов её нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-session-options.test.ts` exit 0 · mac - · cc37261043a60dadb508a0aa4014999a025a1073
  - evidence: review pass · PR #2247 · - - · 81b96cb0fead7b614c0dea90ec3b3db55b60290b
- [ ] `WORFY_SESSION_KIND` получает новое значение; Harness для него печатает свой файл правил.
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0; `node scripts/vitest-electron.mjs test/contract/harness-plugin.test.ts` exit 0 · mac - · cc37261043a60dadb508a0aa4014999a025a1073
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 (assistant gets no common part) · mac - · 269b2a6a3f7a003114e78f29b121a99f0436a6c2
  - evidence: review pass · PR #2247 · - - · 81b96cb0fead7b614c0dea90ec3b3db55b60290b
- [ ] Unit test: у Session Assistant-а нет Bash, записи файлов и сети; есть только tools `worfy-app`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-session-options.test.ts` exit 0 · mac - · cc37261043a60dadb508a0aa4014999a025a1073
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/assistant-session-claude.test.ts test/unit/assistant-session-options.test.ts` exit 0 (real Claude Code: worfy-app call runs its handler, Bash refused) · mac - · 269b2a6a3f7a003114e78f29b121a99f0436a6c2
  - evidence: review pass · PR #2247 · - - · 81b96cb0fead7b614c0dea90ec3b3db55b60290b
- [ ] Unit test: каждое пробуждение — новая Session.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-session.test.ts` exit 0 · mac - · cc37261043a60dadb508a0aa4014999a025a1073
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-session.test.ts` exit 0 (stop, time limit) · mac - · 269b2a6a3f7a003114e78f29b121a99f0436a6c2
  - evidence: review pass · PR #2247 · - - · 81b96cb0fead7b614c0dea90ec3b3db55b60290b
- [ ] Файл памяти хранит обязанности, открытые предложения, обязательства, правила из оценок и ответы пользователя; новая
      Session его читает.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-session.test.ts` exit 0 · mac - · cc37261043a60dadb508a0aa4014999a025a1073
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-session.test.ts` exit 0 (memory as data, size cap) · mac - · 269b2a6a3f7a003114e78f29b121a99f0436a6c2
  - evidence: review pass · PR #2247 · - - · 81b96cb0fead7b614c0dea90ec3b3db55b60290b
- [ ] Session Assistant-а идёт не на Haiku.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-session-options.test.ts` exit 0 · mac - · cc37261043a60dadb508a0aa4014999a025a1073
  - evidence: review pass · PR #2247 · - - · 81b96cb0fead7b614c0dea90ec3b3db55b60290b
- [ ] pr-follow и autopilot-start, которые запустил Assistant, пишутся в журнал Assistant-а (Ticket 08) вместе с
      пунктом, который их вызвал (ADR-0114, граница 6). Сейчас `journal` в `appWorfyAppDeps`
      (`src/main/mcp/app-server.ts`) пишет их только в log main (review PR #2240 Ticket-а 09).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/worfy-app-tools.test.ts` exit 0 · mac - · cc37261043a60dadb508a0aa4014999a025a1073
  - evidence: review pass · PR #2247 · - - · 81b96cb0fead7b614c0dea90ec3b3db55b60290b
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · cc37261043a60dadb508a0aa4014999a025a1073
  - evidence: gate pass · `gate fast` exit 0 · mac - · 269b2a6a3f7a003114e78f29b121a99f0436a6c2
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45741581364/job/139670734653 · ci - · 81b96cb0fead7b614c0dea90ec3b3db55b60290b

## Итог

- Красный до правки: `node scripts/vitest-electron.mjs test/unit/assistant-session-options.test.ts
  test/unit/assistant-session.test.ts test/contract/worfy-app-tools.test.ts` — exit 1, три файла не грузятся (нет
  `ASSISTANT_SESSION_KIND`, `src/main/assistant/session/`, `sessionMemoryStore`); `bash
  harness/hooks/tests/rules-hooks.test.sh` — exit 1 (нет `rules/assistant.md`, часть `assistant` не печатается).
- Session Assistant-а на Claude Code — `src/main/vendors/claude/assistant-session.ts`: `assistantSessionOptions`
  (чистая функция, unit test читает ровно то, что уходит в SDK) и `claudeAssistantQuery`. cwd —
  `<WORFY_DATA_DIR>/assistant/session` вне всех Project-ов; `settingSources: []` — ни `CLAUDE.md`, ни hooks, ни
  настроек Project-а (и пользователя); на Canvas её нет: это не Session реестра, а отдельный query main.
- Третий вид Session для Harness: `WORFY_SESSION_KIND=assistant` (`ASSISTANT_SESSION_KIND`,
  `src/main/vendors/claude/options.ts`). Плагин Harness этой сборки идёт с Session; `inject-rules.mjs` печатает ей
  `harness/hooks/rules/assistant.md` и не печатает `orchestrator`, `product` и `common`; `hooks.json` — шестая команда
  `inject-rules.mjs` на SessionStart. Contract test с настоящим Claude Code против локальной подставки Messages API
  (`test/contract/harness-plugin.test.ts`) показывает, что hook видит переменную.
- Граница 1: `tools: []` (ни одного встроенного tool-а), `disallowedTools` — `ONE_SHOT_DISALLOWED_TOOLS`, один
  MCP-сервер `worfy-app`, policy tier `allowedMcpServers: []` (ни серверов пользователя, ни connectors claude.ai),
  `allowedTools` — ровно tools `worfy-app` под `dontAsk`, который отказывает всем остальным tools без вопроса.
  Граница держится на трёх настройках: `tools: []`, `dontAsk` и `allowedTools`. `canUseTool` нет: под `dontAsk`
  Claude Code его не вызывает. Нет и `allowManagedPermissionRulesOnly`: с ним Claude Code не читает `allowedTools`, и
  `dontAsk` отказывает каждому tool-у `worfy-app`. Серверы плагина не передаются. Contract test с настоящим Claude Code
  против подставки Messages API (`test/contract/assistant-session-claude.test.ts`) проверяет оба края: вызов tool-а
  `worfy-app` доходит до его обработчика, вызов Bash отклонён, и команда не выполнилась.
- Каждое пробуждение — новая Session (`src/main/assistant/session/runner.ts`, `AssistantSessions`): новый id, без
  `resume`, одна за раз (пробуждение во время Session ждёт её конца), закрывается после `result`. Первое сообщение
  пишет main (`wakePrompt`): причина, id пунктов так, как их знает `worfy-app` (без их текста — он чужой), файл памяти
  и сообщение пользователя. Расход — `noteCall` журнала Ticket-а 05: `wake` с id пробуждения, сообщение пользователя —
  `conversation`. Session дольше `ASSISTANT_SESSION_TIME_LIMIT_MS` закрывается (`timed-out`). `stop()` закрывает идущую
  Session и снимает пробуждения в очереди (`stopped`); `composeAssistant.stop` его вызывает: выключенный Assistant
  ничего нового не запускает и не тратит (ADR-0114, решение 10).
- Память в первом сообщении (`memoryForPrompt`) — данные: каждый текст в ней — объект `outside-text` с источником
  `assistant-memory`, как чужой текст в ответах `worfy-app`; в `assistant.md` — строка о том, что запись памяти —
  заметка, а не указание. Размер — не больше `MEMORY_PROMPT_MAX_CHARS`: обязанности и правила всегда, предложения,
  обязательства и ответы — от новых к старым; сколько старых не вошло, сообщение называет.
- Файл памяти — тот же `<WORFY_DATA_DIR>/assistant/memory.json` Ticket-а 07: к обязанностям, правилам из dislike и
  счётчикам добавлены открытые предложения (`ProposalBook` Ticket-а 09 теперь хранит их там и читает после
  перезапуска), обязательства и ответы пользователя (`SessionMemory`, tools `memory_note` и `memory_forget` сервера
  `worfy-app`). Два писателя одного файла: каждая запись читает файл и оставляет часть другого писателя как есть.
  Новая Session получает файл в первом сообщении (`readMemoryView`).
- Сборка в приложении — `startAssistant(power)` в `src/main/assistant/session/app.ts` (`composeAssistant`): решение
  о пробуждении Ticket-а 06 и закрытый список Ticket-а 08 над ядром внимания; пункт, с которым закрытый список не
  справился, идёт в `WakeLoop.escalate`; `appAssistant().userMessage(text)` — для разговора Ticket-а 14.
- `worfy-app`: стык закрытого списка — `closedListOf(appClosedList)` (пока список не запущен — отказ «Assistant is
  off»); pr-follow и autopilot-start, которые запустил Assistant, — строки журнала Ticket-а 08
  (`journalTo(actionJournalFile(...))`) с пунктом, его обязанностью и режимом; что ответила функция main — новое поле
  `detail` строки журнала.
- Записи в инвентарь ADR-0005 и в `docs/features/storage-and-diagnostics.md` — память Assistant-а и папка `session`.

### Решено без владельца (подтвердить)

1. **Ничто ещё не включает Assistant-а.** `src/main/index.ts` не менялся: `startAssistant()` никто не вызывает, пока
   нет выключателя (Ticket 15, «включение»). С выключенным Assistant-ом не работает ни решение о пробуждении, ни
   закрытый список, ни Session, расхода нет (ADR-0114, решение 10). Поэтому `worfy-app` и Session Assistant-а в
   сборку main пока не попадают: `pnpm build` зелёный, но проверить, что они собираются в main, придётся Ticket-у 15.
2. **Значение `WORFY_SESSION_KIND`** — `assistant`; файл правил — `harness/hooks/rules/assistant.md`; файл памяти — тот
   же `assistant/memory.json` Ticket-а 07 (не отдельный файл: ADR-0114 называет один файл состояния).
3. **Модель** — `opus` (алиас сильнейшей, как у Product Session, `PRODUCT_SESSION_MODEL`); предел ходов одной Session —
   40 (`ASSISTANT_MAX_TURNS`).
4. **Транскрипта нет** (`persistSession: false`): 20 пробуждений в день не засоряют `~/.claude/projects` и список
   `/resume`; всё, что нужно следующей Session, — в файле памяти. Разговор Ticket-а 14 возьмёт текст из ответа
   `AssistantSessions.wake`, а не из транскрипта.
5. **Память читается первым сообщением**, а не tool-ом: так новая Session читает её всегда. Tool-а чтения памяти нет;
   писать — `memory_note` (обязательство с необязательным `due` ISO 8601; ответ — тема и текст, новый ответ на ту же
   тему без учёта регистра заменяет старый) и `memory_forget`. Пределы: 50 обязательств, 100 ответов, 500 и 2000
   символов; секреты скрываются до записи.
6. **Одна Session за раз:** пробуждение во время Session ждёт её конца, а не идёт параллельно.
7. **Session, которая не стартовала,** — в лог, расхода нет; Session, которая сломалась после старта или кончилась без
   `result`, — `noteCall` с нулевым `usage` (как у Ticket-а 11).
8. **Под `WORFY_AGENT=fake`** Session Assistant-а не стартует (отказ в лог): fake агента для неё нет, e2e — Ticket-ы
   14–16.
9. **Строка журнала pr-follow и autopilot-start** — `by: 'assistant'`, `sessionId: null`, ответ функции main в новом
   поле `detail` (поле `text` — только текст, который main отправил в Session; `reason` — перечень отказов закрытого
   списка, свободный текст в него не ложится).
10. **`noteOtherTurn`** (доля Assistant-а в окне Limits, Ticket 05) по-прежнему никто не вызывает: Ticket 10 его не
    просит; оценка остаётся верхней границей.
11. **Предел времени одной Session — 15 минут** (`ASSISTANT_SESSION_TIME_LIMIT_MS`). Обычная Session укладывается в
    минуту-две; `action_run autopilot-start` может ждать диалог пользователя до 10 минут (`chat-confirm.ts`), и предел
    оставляет место для одного такого ожидания и работы вокруг него. Session, закрытая по пределу, — `noteCall` с
    нулевым `usage`, как сломавшаяся.
12. **Память в первом сообщении — не больше 32 000 символов** (`MEMORY_PROMPT_MAX_CHARS`, около 8k tokens): полная
    память (100 ответов по 2000 символов и 50 обязательств) стоила бы около 55k tokens opus на каждое пробуждение.
    Обязанности и правила идут всегда; дальше — от новых к старым, и на первой записи, что не влезла, заполнение
    кончается. Старые записи остаются в файле; для обязательств и ответов tool-а чтения нет — Assistant видит только
    их число.
13. **Session Assistant-а не получает часть `common` правил Harness** (около 7k символов): правила отчётов, test-ов и
    gate ей не нужны, а платить за них пришлось бы на каждом пробуждении. Часть `compaction` на PreCompact остаётся.
