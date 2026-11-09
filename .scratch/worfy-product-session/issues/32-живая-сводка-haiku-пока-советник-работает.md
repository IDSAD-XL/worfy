# 32 — живая сводка от Haiku, пока советник работает

Type: feature
Branch: worfy-product-session/32
Blocked by: 29
Source: владелец 2026-11-09: «для Product Session добавить параллельно дешёвую модель Haiku, которая бы просто
Status: blocked 2026-11-09T20:00Z
Blocked reason: PR #1743 merged; owner's look in Mac Stable after the next update, with the first real Haiku call (item 8)
Waits: owner

показывала актуальные более развернутые статусы. Пока сессия работает, она обычно работает очень долго, непонятно,
что происходит. Хотелось бы видеть, что происходит, хотя бы короткими статус-обновлениями, но чтобы они после полного
ответа удалялись и не засоряли чат.»; [spec.md](../spec.md)

Не платформенный Ticket (правка main и renderer, без путей и процессов ОС сверх тех, что уже запускает Terminal AI).
Глубина ревью — `medium`; снимок экрана.

## Что происходит

- Строка статуса ticket-а 29 (`src/renderer/session/advisor-status.ts`, `AdvisorStatus.tsx`) говорит, какой шаг идёт
  сейчас: «Reading map.md», «Searching the web for …», «Thinking…». Зачем советник это делает и к чему идёт — не
  видно. Turn Product Session идёт минутами, и владелец не понимает, что происходит.

## Что делаем

Слова UI остаются английскими (`docs/design/BRIEF.md`).

1. **Narrator.** Пока идёт turn Product Session, main время от времени просит Haiku об одной короткой строке, не
   длиннее 120 знаков, на языке, которым пользователь пишет в чате (иначе по-английски): что делает советник и зачем.
   Пример: «Сравнивает три источника о ценах конкурентов, чтобы оценить нишу».
   - Вход — сжатый digest turn-а: сообщение пользователя (обрезанное), последние tool call-ы с короткими входами,
     последние куски текста и thinking (обрезанные), прошлые строки narrator-а, чтобы он не повторялся. Жёсткий
     предел digest-а — 5000 знаков.
   - Запрос идёт тем же путём Claude Code / Agent SDK и под тем же login, что и Sessions: модель `haiku`, без tool-ов,
     один turn, короткий ответ. API-ключи не используются никогда (правило владельца).
   - Session на haiku не запускается (`src/main/agent/session.ts`, isSelectableModel); narrator — не Session, это
     сказано в комментарии.
2. **Ритм.** Первая строка — не раньше, чем через 20 s от начала turn-а. Дальше — не чаще раза в 30 s и только если
   с прошлой строки пришли новые события. Двух запросов одновременно не бывает. Конец turn-а, Interrupt или ошибка
   останавливают narrator сразу; ответ, пришедший позже, выбрасывается.
3. **Показ.** Под строкой статуса ticket-а 29 — последние 1–3 строки narrator-а, новая снизу, приглушённые и мелкие, с
   меткой «summary» и tooltip «Short summary by Haiku while the advisor works». Это не сообщения чата: их нет в
   транскрипте и в истории Session, и все они уходят, когда пришёл полный ответ.
4. **Настройка.** Переключатель «Live summary while the advisor works» в Settings → Sessions, включён по умолчанию.
   Выключен — ни одного запроса к Haiku.
5. **Цена и сбой.** Каждый запрос маленький. Запрос упал, упёрся в лимит или у пользователя нет доступа к Haiku —
   narrator молчит до конца turn-а; в чате ошибки нет, только строка в log.

## Решено без владельца

1. Narrator живёт в main (`src/main/agent/narrator.ts`) и подключён к Product Session-ам Node-ов
   (`node-sessions.ts`): только они бывают `kind: product`. Session-у он не трогает, а читает её события.
2. Строки идут в окна событием `narration` (весь набор строк, пустой — убрать, и `first` — номер первой строки среди
   строк turn-а, чтобы каждая строка сохраняла свой элемент и screen reader не перечитывал старые) по тому же `agent.event`. Store
   renderer-а держит их отдельно от списка событий, как `queue` и `context`: в транскрипт они не попадают и в файл
   транскрипта Claude Code не пишутся.
3. Запрос — холодный `query()` Agent SDK с опциями как у Terminal AI (ADR-0058): без настроек пользователя и Project-а
   (`settingSources: []`), без MCP, без tool-ов, `maxTurns: 1`, без транскрипта (`persistSession: false`), без
   thinking, среда агента без API-ключей, папка `<WORFY_DATA_DIR>/narrator` вне всех Project-ов. Короткий ответ —
   `CLAUDE_CODE_MAX_OUTPUT_TOKENS=256` в среде процесса.
4. Язык выбирает сама модель по сообщению пользователя в digest-е (инструкция в system prompt); отдельного определения
   языка нет.
5. Ритм считается от начала прошлого запроса; «новые события» — tool call, ответ tool-а, текст, thinking, delta,
   Subagent. Новое событие после истёкших 30 s запускает запрос сразу, без опроса по таймеру.
6. Новая строка встаёт снизу (порядок чтения); повтор последней строки не показывается; строка обрезается до 120
   знаков с «…».
7. Настройка — в Settings → Sessions, а не в меню Modes: Modes есть только у Orchestrator-а и держит режимы
   Project-а, а сводка — настройка всего приложения (`productSession.liveSummary` в настройках приложения).
8. Под `WORFY_AGENT=fake` narrator играет скрипт `test/fixtures/agent-scripts/<WORFY_NARRATOR_SCRIPT или
   narrator>.jsonl` через fake agent, а ритм можно ужать переменными `WORFY_NARRATOR_FIRST_MS` и
   `WORFY_NARRATOR_EVERY_MS` (читаются только под fake), чтобы e2e не ждал 20 s.

Владелец 2026-11-09 подтвердил решения 4 и 7 (язык строки, место и умолчание переключателя); предел — на одну
Product Session, общего предела на всё приложение нет. Слово narrator остаётся внутренним: в UI и docs/features —
Live summary (термин в `CONTEXT.md`).

## Готово, когда

- [ ] Unit test на fake agent (`test/unit/narrator.test.ts`, красный до правки): нет запроса раньше 20 s, не чаще раза
  в 30 s, нет запроса без новых событий, никогда двух сразу; остановка на result, Interrupt и ошибке; поздний ответ
  выброшен; настройка выключена — запросов нет; digest обрезан и не длиннее предела; сбой запроса заглушает turn.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/narrator.test.ts on the fake agent; 11 mutants of narrator.ts killed) · mac - · 201790dd92bfe3a72265b6f562ec26313b93360b
  - evidence: test-run pass · `pnpm test` exit 0 (round 2: switch re-checked before showing, a new turn asks after a stale request; 13 more mutants killed) · mac - · 91e2e02a692c884fc312471eb42d852c45aac087
- [ ] Unit test опций запроса Haiku: модель `haiku`, без tool-ов, один turn, без транскрипта, без API-ключей.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/narrator-options.test.ts) · mac - · 201790dd92bfe3a72265b6f562ec26313b93360b
- [ ] Unit test renderer-а: строки стоят под строкой статуса, приглушённые, с меткой summary, не в транскрипте, и
  уходят с result.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/product-transcript.test.tsx) · mac - · 201790dd92bfe3a72265b6f562ec26313b93360b
  - evidence: test-run pass · `pnpm test` exit 0 (round 2: settings-sessions switch, app-narrator wiring, stable line elements) · mac - · 91e2e02a692c884fc312471eb42d852c45aac087
- [ ] e2e test (`test/e2e/product-session.spec.ts`): scripted agent проходит turn, под строкой статуса видна строка
  narrator-а, после ответа её нет.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 (9 passed) · mac dev · c63335194
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 (9 passed, round 2) · mac dev · e046d216b
- [ ] Снимок (тёмная тема) в папке вывода test-а, в репозиторий не кладётся.
- [ ] Страница `docs/features/product-session.md` говорит о живой сводке и настройке; `node
  scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 201790dd92bfe3a72265b6f562ec26313b93360b
- [ ] `pnpm lint`, `pnpm typecheck`, unit и contract test-ы `src/main/agent` и renderer-а Product Session, e2e
  `test/e2e/product-session.spec.ts`, gate fast — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (711 files passed) · mac - · 201790dd92bfe3a72265b6f562ec26313b93360b
  - evidence: gate pass · `gate fast` exit 0 · mac - · 201790dd92bfe3a72265b6f562ec26313b93360b
  - evidence: gate pass · `gate fast` exit 0 (round 2) · mac - · 91e2e02a692c884fc312471eb42d852c45aac087
- [ ] вручную: владелец смотрит живую сводку в чате Product Session в Mac Stable (настоящий Haiku).

## Тесты

- `test/unit/narrator.test.ts` (новый), `test/unit/narrator-options.test.ts` (новый),
  `test/unit/product-transcript.test.tsx`, `test/contract/node-sessions.test.ts`, `test/unit/advisor-status.test.tsx`, остальные unit test-ы `src/main/agent` и
  `src/renderer/session`.
- `test/e2e/product-session.spec.ts`, `test/fixtures/agent-scripts/narrator.jsonl` (новый).

## Где в коде

- `src/main/agent/narrator.ts` (новый), `src/main/agent/app-narrator.ts` (новый), `src/main/agent/node-sessions.ts`,
  `src/main/agent/app-node-sessions.ts`
- `src/main/vendors/claude/narrator.ts` (новый)
- `src/shared/agent/events.ts`, `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`
- `src/renderer/session/store.ts`, `src/renderer/session/Transcript.tsx`, `src/renderer/session/SessionView.tsx`,
  `src/renderer/session/Narration.tsx` (новый), `src/renderer/session/session.css` (только `.w-pmsg…`)
- `src/renderer/settings/SessionsSection.tsx`
- `test/unit/narrator.test.ts`, `test/unit/narrator-options.test.ts`, `test/unit/product-transcript.test.tsx`,
  `test/contract/node-sessions.test.ts`, `test/contract/app-settings.test.ts`, `test/unit/app-narrator.test.ts`,
  `test/unit/settings-sessions.test.tsx`, `test/e2e/product-session.spec.ts`,
  `test/fixtures/agent-scripts/narrator.jsonl`
- `docs/features/product-session.md`, `docs/features/sessions.md`, `CONTEXT.md` (термин Live summary)
