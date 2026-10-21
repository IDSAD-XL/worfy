# 07 — Английские комментарии в коде и правило lint против кириллицы

Type: task
Status: done 2026-10-21T01:01Z
PR: #625
Blocked by: 03, 04, 05, 06
Source: решения владельца 2026-10-19, Q6, Q11, Q14, Q15 ([spec.md](../spec.md), «Решения владельца», пункты 6,
11, 14, 15); [ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md), пункт 5.

## Что происходит

Замер по main `07f17fa3` (до 03–06; к началу этого Ticket-а протокол уже английский):

- `src/` — 93 строки с кириллицей в 44 файлах, 76 из них — комментарии.
- `scripts/` — 35 строк: 7 комментариев, остальное — разделы документов и сообщения (их меняет 06).
- `test/` вне `test/fixtures/` — 16 строк комментариев; `test/fixtures/` — 56 файлов русских данных (остаются, Q11).
- `harness/` без `.md` — 525 строк в 30 файлах и 1004 строки в test-ах и eval-кейсах; после 03–06 остаются
  комментарии и данные test-ов на русский ввод.
- Текст интерфейса по-русски: заголовок уведомления «… ждёт тебя» (`src/main/workflow/waits-notify.ts:54`).
  Интерфейс worfy английский (`docs/design/BRIEF.md`), каталога переводов нет.
- `eslint.config.js` — правила lint; `pnpm lint` = `eslint .` и два скрипта документов.
- **Платформенный PR** (Q15) — вердикт Windows.

## Что делаем

1. Комментарии, имена test-ов и сообщения логов в `src/`, `scripts/`, `test/`, `harness/` — по-английски, смысл
   прежний.
2. Строка интерфейса `waits-notify.ts:54` — по-английски («… is waiting for you»). Каталог переводов не
   заводится: одна строка не стоит системы (spec, «Не в этом Epic-е»).
3. **Правило lint**: кириллица запрещена в `src/`, `scripts/`, `test/`, `harness/` (код, `.sh`, `.mjs`, `.cjs`,
   `.ts`, `.tsx`); разрешена в `test/fixtures/**`, в строковых литералах test-ов (данные русского ввода, с
   английским комментарием, зачем), в файле слов ввода Harness `harness/lib/input-words.json` (Ticket 04) и в местах с пометкой
   `shortcut: accepts the old Russian token` до 08. В комментариях — нигде. Для `.sh` и файлов без
   расширения, которые ESLint не читает, — отдельный скрипт в `pnpm lint`.
4. `.md` в `harness/` — без кириллицы, кроме цитат старых форм, которые принимаются один релиз (их убирает 08).

## Готово, когда

- [x] Test правила lint: файл с кириллицей в комментарии `src/` — ошибка; та же строка в `test/fixtures/` — нет;
      литерал данных в test-е — нет. Красный до правила.
- [x] `pnpm lint` — exit 0 на ветке; на копии main до правки — ненулевой код (правило ловит сегодняшние места).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge; вердикт
      Windows с ПК.

## Тесты

Сначала test правила lint на маленьких файлах во временной папке.

## Где в коде

- `eslint.config.js`
- `scripts/check-cyrillic.mjs` (новый, для `.sh` и файлов без расширения) и строка в `package.json` (`lint`)
- `src/**`, `scripts/**`, `test/**` вне `test/fixtures/`, `harness/**` — комментарии
- `src/main/workflow/waits-notify.ts`
- `test/unit/check-cyrillic.test.ts` (новый)

Заметки из ревью 04–06: пометка `shortcut: accepts the old Russian token` стоит на одну–две строки выше строк с
кириллицей — исключение «только следующая строка» их не покроет; внутри `harness/` пометка без
`(worfy-neutral 08)`. Русская команда Wave старого Harness — данные test-ов launch / render-template /
binding / projects и `test/e2e/autopilot.spec.ts:332` («Итог» 05).

## Итог

Влит #625 (a6fa6e2e). Проверки Orchestrator-а: gate full — зелено на `main` 9848f563; вердикт Windows с ПК
(`check/windows` на f4eabb77; первый прогон был красным — helper test-а сравнивал путь ESLint с `\`, исправлено).
Review: круг 1 — high, три lens (3 med); круг 2 — medium (1 med: here-string открывал heredoc); круг 3 —
исправление, проверено пробами; high и med не осталось.

- `scripts/check-cyrillic.mjs` — одно правило ESLint `worfy/no-cyrillic` для JS и TS и команда в `pnpm lint`
  для `.sh`, `.zsh`, `.bash`, файлов без расширения (shell — построчно, с кавычками, heredoc, here-string и
  `$(( ))`), `harness/**/*.md`, `.css`, `.html`, `.yaml`. JSON — данные, не проверяется.
- Комментарии и имена test-ов — без исключений. Вне комментариев кириллица разрешена: в `test/fixtures/**`; в
  test-файлах (`test/`, папки `tests/`, `*.test.*`, `*.spec.*`, `harness/evals/`); в узле или команде сразу
  после комментария `shortcut: accepts the old Russian token` (пометка в конце строки покрывает только свою
  строку или команду); в `harness/` — слова временного списка `scripts/cyrillic-allow.json` (подстановки
  Profile, заголовки `rules.md`, имена lens — их убирает Ticket 10). Файл слов ввода
  `harness/lib/input-words.json` — JSON, не проверяется.
- На копии `main` до правки: команда — 63 строки, ESLint — 82 ошибки в 53 файлах; на ветке — exit 0.
- Строка интерфейса `waits-notify.ts` — `<ticket> is waiting for you`. PR #577 (pipeline 10) проверяет
  старый русский заголовок — переводит свои проверки при rebase.
- Из description skill-ов connect-project, continuous-audit, retro, tickets-to-tasks убраны русские
  фразы-вызовы («or the same words in the user's language»). Если они нужны владельцу — место им в
  `~/.claude/worfy-harness/user/rules.md` (шаг владельца). connect-project теперь всегда пишет `## Sources`.
- Пометка в front matter `harness/skills/epic-wave/SKILL.md` — YAML-комментарий между ключами: js-yaml
  разбирает все 10 skill-ов; настоящим загрузчиком Claude Code не проверено.

Отступление от «Что делаем», пункт 3: английский комментарий «зачем» у русских данных test-ов lint проверить не
может; около 70 test-файлов его не имеют (часто это русские документы worfy как вход). Правка выросла бы до
~150 файлов — не делали.

Долг (low):
- разбор shell повторяет разбор `harness/bin/shortcut-ledger` — свести к одному;
- многострочное `(( … <<` читается как heredoc (глубина `((` считается внутри строки) — принято;
- имя test-а через переменную (`it(name, …)`) не проверяется;
- allowlist-ы `harness-home.test.sh:323-366`, `epic-wave-ship-ticket.test.sh:488-495` перечисляют строки,
  которых в skill-ах больше нет; `agents-text.test.sh:122-125` дублирует список подстановок (Ticket 10);
- четыре старых `shortcut:` без условия «когда переделать»: `harness/hooks/guard.mjs:214`,
  `scripts/dev-bundle.ts:108`, `scripts/eval-harness.mjs:279`, `src/renderer/canvas/sources/epics.ts:370`.
