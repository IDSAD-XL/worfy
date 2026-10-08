# 21 — Пометка «Harness в main новее, чем в Stable copy» в worfy и в журнале прогона Autopilot

Type: task
Status: claimed — 2026-10-08
Blocked by: 12
Source: решения владельца 2026-10-07, Q14 и Q12; [ADR-0047](../../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md) (развитие Harness: урок — PR в `harness/`, во время Autopilot Stable copy не пересобирается); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (доставка Harness, версия `<semver>+<SHA>`); [spec.md](../spec.md)

## Что происходит

- Autopilot над самим worfy идёт из Stable copy (`~/Applications/worfy-stable.app`). Копию ставит
  `scripts/install-stable.sh`: собирает `.app` и пишет рядом `<target>.json` с полем `commit` —
  `git rev-parse HEAD` checkout-а, из которого шла сборка (`scripts/install-stable.sh:68`, `:93`).
  Пока копия запущена, скрипт отказывает (`scripts/install-stable.sh:41`).
- Решение Q14 (ADR-0047): во время прогона Autopilot Stable copy не пересобирается. Урок — PR в
  `harness/` — мержится, а прогон доходит до конца на старом Harness. Сейчас этого не видно ни в
  worfy, ни в журнале прогона: владелец не узнаёт, что Harness в main ушёл вперёд и копию пора
  пересобрать.
- Версии приложения пока нет: `package.json:3` — `"version": "0.0.0"`. Ticket 04 (версия
  приложения и Harness) заводит semver и строку `<semver>+<короткий SHA>` в
  `harness/.claude-plugin/plugin.json` при сборке. Ticket 12 (worfy находит Harness в папке plugin)
  даёт путь Harness, который Session-ы этой сборки передают inline (`plugins: [{type:'local', path}]`).
- Журнал прогона — `<WORFY_DATA_DIR>/autopilot/<run>.jsonl`. Его формат описан комментарием
  `src/shared/autopilot/journal.ts:1-60`, виды строк — `JOURNAL_EVENT_KINDS`
  (`src/shared/autopilot/journal.ts:81`), схема — `src/shared/autopilot/journal.ts:141-153`. Строки
  про версию Harness нет. Первую строку `run-started` пишет `openRun`
  (`src/main/autopilot/journal.ts:86-96`), `wave-started` — `src/main/autopilot/run.ts:466-470`.
- Строка состояния Autopilot на рамке Epic-а — `autopilotStatusLine`
  (`src/shared/ipc/autopilot.ts:61-77`); показ — `src/renderer/canvas/actions/AutopilotAction.tsx:95`,
  `:118-123`. Состояние прогона — `autopilotStateSchema` (`src/shared/ipc/autopilot.ts:18-36`).
- Dev-сборка Autopilot над репозиторием worfy не запускает (`selfProjectRefusal`,
  `src/main/autopilot/run.ts:153-164`); packaged-сборка — запускает.

## Что делаем

1. **Сравнение версий (Q14).** Новый модуль main `src/main/autopilot/harness-drift.ts`. На входе —
   корень репозитория Project-а и версия Harness этой сборки. Ответ — один из трёх: «Harness в main
   новее» с числом коммитов; «не новее»; «не знаю» с причиной одной строкой.
   - Версия Harness этой сборки — строка `<semver>+<SHA>` из `plugin.json` того Harness, который
     Session-ы этой сборки передают inline (путь — Ticket 12, формат — Ticket 04). Нет `+<SHA>` —
     «не знаю».
   - Проверка идёт только для репозитория самого worfy: в нём есть
     `harness/.claude-plugin/plugin.json` с `"name": "worfy"`, и `git cat-file -e <SHA>^{commit}`
     находит коммит сборки. Иначе пометки нет, причина — в лог один раз на Project.
   - main — `origin/main`, если такой ref есть, иначе локальная `main` (основная ветка worfy —
     `main`).
   - «Новее» — `git rev-list --count <SHA>..<main> -- harness/` больше нуля: в main есть правки
     `harness/`, которых нет в сборке.
   - Только чтение. worfy не делает `git fetch`: это запись в `.git` Project-а, а ADR-0005 (worfy
     ничего не пишет в репозитории Project-ов) это запрещает. `origin/main` свежий, потому что
     Orchestrator делает `git fetch` в предполёте каждой Wave.
   - Не чаще раза в 60 с на Project.
   - Только packaged-сборка. Dev-сборка идёт на Harness своего checkout-а, и пометки у неё нет.
2. **Журнал прогона (Q14).** Новый вид строки `harness-behind` с полями `harness` (версия сборки),
   `main` (ref, с которым сравнивали) и `commits` (число коммитов). worfy пишет её сразу после
   `run-started`, если Harness отстаёт, и перед каждым `wave-started`, если число изменилось: урок
   влит посреди прогона. Вид описывается в комментарии-спецификации
   `src/shared/autopilot/journal.ts`. Журналы без этой строки читаются как раньше.
3. **Пометка в worfy (Q14).** `autopilotStateSchema` получает поле `harnessBehind`:
   `{harness, main, commits}` или `null`. Действие Autopilot на рамке Epic-а показывает под строкой
   состояния chip «Harness in main is newer than the Stable copy»
   (`data-testid="autopilot-harness-behind"`). Подсказка chip-а называет число коммитов и
   пересборку: «pnpm install:stable between runs». Chip виден и во время прогона, и когда прогон
   остановлен. Стиль — существующий класс `w-chip`, новых токенов нет. Текст — по-английски, как у
   других действий UI (`docs/design/BRIEF.md`).
4. **Пересборки нет (Q14).** worfy сам Stable copy не пересобирает и прогон не перезапускает.
   Пересборка — `pnpm install:stable` или CLI, когда прогон не идёт; скрипт и так отказывает при
   запущенной копии.
5. **F-SPEC.** В раздел Autopilot `docs/design/F-SPEC.md` (его пишет Ticket 03, раздел Autopilot в
   F-SPEC) — одна строка о chip-е. Раздела ещё нет — строку не добавлять и сказать об этом в «Итог».

ADR не нужен: решение уже принято в ADR-0047.

**Не входит:** пересборка Stable copy во время прогона (Q14 её отвергает); показ версии Harness в UI
(Ticket 04); установка и обновление plugin (Ticket 13).

## Готово, когда

- [ ] Contract test `test/contract/harness-drift.test.ts` на временном git-репозитории с `harness/.claude-plugin/plugin.json` (`"name": "worfy"`): коммит в `harness/` после SHA сборки — «новее», `commits: 1`; коммит только вне `harness/` — «не новее»; SHA, которого нет в репозитории, — «не знаю»; версия без `+<SHA>` — «не знаю»; репозиторий без `harness/.claude-plugin/plugin.json` — пометки нет.
- [ ] Тот же test: после проверки у репозитория те же refs (`git for-each-ref`), тот же `git status --porcelain`, нет `FETCH_HEAD`; подменённый `git` не получает `fetch`.
- [ ] Unit test `test/unit/autopilot-run.test.ts`: при отставании строка `harness-behind` идёт сразу после `run-started`; урок, влитый между Wave-ами, даёт новую строку перед следующим `wave-started`; без отставания и в dev-сборке строки нет.
- [ ] Unit test `test/unit/autopilot-journal.test.ts`: строка `harness-behind` проходит схему; журнал без неё читается как раньше.
- [ ] Unit test `test/unit/canvas-actions.test.tsx`: при `harnessBehind` действие Autopilot показывает chip `autopilot-harness-behind`, его `title` называет число коммитов и `pnpm install:stable`; при `null` chip-а нет.
- [ ] e2e `@packaged` в `test/e2e/packaged.spec.ts`: установленная копия; Project — `git clone --shared` репозитория worfy во временную папку, где `origin/main` указывает на коммит в `harness/` поверх коммита сборки, — chip виден; клон, где `origin/main` — сам коммит сборки, — chip-а нет. Идёт в `pnpm test:package`, то есть в локальном `gate full`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; локальный `gate full` под замком `/tmp/worfy-e2e.lock` (правила Profile worfy) — код 0 и вердикт «зелено».
- [ ] (вручную) Stable copy, собранная до влития PR в `harness/`: после влития на рамке Epic-а worfy виден chip; после `pnpm install:stable` и перезапуска копии chip-а нет. Как проверить: окно приложения.

Ручной пункт агент проверяет, только если может посмотреть окно Stable copy. Если не может —
«не проверено: …» в «Итог» и пункт в HANDOFF, раздел «Ждёт владельца».

## Тесты

Сначала падающий test — `test/contract/harness-drift.test.ts`, случай «коммит в `harness/` после
SHA сборки». На нынешнем main модуля `harness-drift.ts` нет — test падает на импорте. В «Итог» —
как он падал.

- `test/contract/harness-drift.test.ts` — новый: сравнение и отсутствие записи в репозиторий.
- `test/unit/autopilot-run.test.ts` — строки `harness-behind` в журнале прогона.
- `test/unit/autopilot-journal.test.ts` — схема нового вида строки.
- `test/unit/canvas-actions.test.tsx` — chip в действии Autopilot.
- `test/e2e/packaged.spec.ts` — chip на установленной копии (`@packaged`).

## Где в коде

- `src/main/autopilot/harness-drift.ts` — новый: сравнение версии сборки с папкой harness в main
- `src/main/autopilot/run.ts`
- `src/main/ipc/autopilot.ts`
- `src/shared/autopilot/journal.ts`
- `src/shared/ipc/autopilot.ts`
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `docs/design/F-SPEC.md`
- `test/contract/harness-drift.test.ts` — новый
- `test/unit/autopilot-run.test.ts`
- `test/unit/autopilot-journal.test.ts`
- `test/unit/canvas-actions.test.tsx`
- `test/e2e/packaged.spec.ts`
- `test/contract/autopilot-journal.test.ts` — добавлено при реализации: список всех видов строк журнала получил `harness-behind`
- `test/contract/autopilot.test.ts`, `test/contract/autopilot-limits.test.ts` — добавлено при реализации: в состоянии Autopilot новое обязательное поле `harnessBehind`; `autopilot.state` заново спрашивает сравнение

`run.ts` получает сравнение зависимостью в опциях Autopilot, `ipc/autopilot.ts` её подставляет.
Версию сборки модуль читает тем же способом, что показ версии Ticket-а 04; если для этого нужен
файл Ticket-а 04 или 12, исполнитель добавляет его сюда и проверяет пересечения с Ticket-ами Wave.

## Итог

Заполняется при закрытии.
