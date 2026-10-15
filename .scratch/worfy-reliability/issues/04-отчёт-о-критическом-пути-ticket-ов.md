# 04 — Отчёт о критическом пути Ticket-ов: claim → PR → CI → Gate → merge по уже записанным событиям

Type: task
Status: claimed — 2026-10-15
Blocked by: —
Source: [spec.md](../spec.md), решение владельца 2026-10-15, пункт 1 (идея F); исследование
[PR #325](https://github.com/IDSAD-XL/worfy/pull/325), раздел «F. P2: measure the critical path
instead of accelerating individual agents»; [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md);
[ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md).

## Что происходит

- Сколько Ticket ждёт на каждом шаге — неизвестно: никто не считал. Решения «что ускорять» сейчас —
  догадка.
- **События уже записаны, нового хранилища не нужно** (ADR-0002):
  - журнал прогона Autopilot — `<папка данных worfy>/autopilot/<run>.jsonl`, на Mac
    `~/Library/Application Support/worfy/autopilot/` (`src/main/autopilot/journal.ts:1`). У каждой
    строки есть `at` (`:71`). Формат и виды событий — шапка `src/shared/autopilot/journal.ts`,
    список видов — `JOURNAL_EVENT_KINDS` (`:146-163`): `wave-started`, `wave-finished`,
    `narrow-round`, `limits-hit`, `waiting-until`, `resumed`, `session-error`, `run-stopped` и
    другие; пишет их `src/main/autopilot/run.ts`. Строку не-JSON или неизвестного вида читатель
    пропускает и считает (`journal.ts:138-140`);
  - Status Ticket-а — `claimed — <дата>` при claim (`bin/ticket` Harness) и `done — <дата>, [PR #N]`
    при закрытии; разделы «Итог» — круги ревью и Gate;
  - git — коммиты веток `<эпик>/<NN>` и мерж в main;
  - PR — `gh pr view <N> --json createdAt,mergedAt,statusCheckRollup,comments`: открытие, CI,
    комментарии Gate (`VERIFIED`, `REJECTED`, `NARROW: …`), мерж.

## Что делаем

1. **Скрипт `scripts/critical-path.mjs`** (Node, без зависимостей сверх уже имеющихся). Вход:
   папка журналов (по умолчанию — папка данных worfy), корень Project-а, Epic или список Ticket-ов.
   Данные PR — через `gh` или из файла JSON (`--prs <файл>`), чтобы test-ы шли без сети.
2. **Для каждого Ticket-а** — моменты и длительности шагов: claimed (или `wave-started` с этим
   Ticket-ом) → PR открыт → CI зелёный → Gate (`VERIFIED`) → merge. Отдельно: время ожидания Limits
   (`limits-hit` / `waiting-until` → `resumed`), число кругов доработки (`REJECTED` в PR, события
   `narrow-round`), остановки прогона (`session-error`, `run-stopped`). Шаг, о котором данных нет, —
   пустая ячейка с причиной, а не ноль.
3. **Сводка по Epic-у или Wave:** какой шаг дольше всего в сумме и в медиане — это и есть ответ.
4. **Вывод** — Markdown (по умолчанию) или CSV (`--csv`), в stdout или в путь из `--out`. Скрипт
   только читает: в репозитории Project-ов, `~/.claude` и папку данных worfy он не пишет (ADR-0005).
5. В отчёт не идут тексты транскриптов, токены и личные пути: только номера Ticket-ов, PR, время.

## Готово, когда

- [x] `node scripts/critical-path.mjs --help` печатает вход и выход; без аргументов — отчёт по
      журналам папки данных, exit 0.
- [x] На fixture-журнале и fixture PR unit test-ы проверяют длительности каждого шага, ожидание
      Limits, круги доработки и пустую ячейку при нехватке данных.
- [x] Битая строка и строка неизвестного вида в журнале пропускаются и считаются, отчёт строится.
- [x] Test проверяет, что скрипт ничего не пишет вне `--out` (временная папка, список файлов до и после).
- [x] (вручную) Отчёт по настоящим журналам Mac владельца для одного закрытого Epic-а — в «Итог»,
      без личных путей; какой шаг вышел критическим.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/critical-path.test.ts` — запуск скрипта через `spawnSync`, как
  `test/unit/check-handoff.test.ts`; fixture — `test/fixtures/critical-path/` (журнал JSONL, PR JSON,
  Ticket-ы с Status).
- Сначала красный: test на длительность шага «PR → merge» по fixture до появления скрипта.
- Мутанты: перепутать `at` двух событий; считать пустую ячейку нулём; писать файл рядом с журналом.
  Каждый краснит свой test; итог — в «Итог».

## Где в коде

- `scripts/critical-path.mjs`
- `test/unit/critical-path.test.ts`
- `test/fixtures/critical-path/`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/shared/autopilot/journal.ts`, `src/main/autopilot/journal.ts`, `src/main/autopilot/run.ts`,
`test/unit/check-handoff.test.ts`.

## Вне скоупа

- Вид в окне worfy (UI) — только отчёт скрипта.
- Новое хранилище событий и новые поля журнала (ADR-0002).
- Время внутри шага исполнителя по транскриптам.

## Риски

- **Старые журналы беднее:** часть видов событий появилась позже (`narrow-round`, `harness-behind`).
  Ячейка без данных — пустая с причиной.
- **Дата claim — без времени** (`claimed — <дата>`): точный момент — `wave-started`, без Autopilot —
  первый коммит ветки.

## Итог

**Что сделано.** `scripts/critical-path.mjs` (Node, без новых зависимостей) строит по журналам
Autopilot, Status Ticket-ов (`--root`) и данным PR (`gh` или `--prs <файл>`) таблицу на каждый
Epic: шаги claim → PR → CI → Gate → merge, Total, ожидание Limits, круги доработки (`REJECTED` в
PR), narrow-круги (`NARROW:` в PR, без PR — события `narrow-round`), остановки прогона
(`session-error`, `run-stopped` при открытой Wave). Сводка Epic-а — сумма и медиана каждого шага и
критический шаг по обеим. Вывод — Markdown или `--csv`, в stdout или `--out`. Пустая ячейка — «—»
с причиной. В отчёте только номера Ticket-ов, PR и время: текст сообщений, ответов Orchestrator-а,
комментариев и пути не печатаются; домашняя папка в ответе `gh` заменяется на `~`.

**Решено без владельца, подтвердить:**

- Папка журналов по умолчанию — `--journals <папка>`, иначе `WORFY_DATA_DIR/autopilot`, иначе
  `~/Library/Application Support/worfy/autopilot` через `posix.join`, без ветки по
  `process.platform` (как `scripts/hang-sample.mjs`). Ветка по платформе сделала бы PR
  платформенным (ADR-0056, пункт 2). На Windows папку передают `--journals` или `WORFY_DATA_DIR`;
  так сказано в `--help`.
- Момент «CI зелёный» берётся из истории workflow run-ов ветки (`gh run list --branch`): последний
  успешный run до Gate `VERIFIED`; ручной запуск (`workflow_dispatch`) не считается. Причина:
  `statusCheckRollup` из `gh pr view` знает только проверки последнего коммита, а rebase перед
  merge перезапускает CI уже после Gate. На настоящих журналах `worfy-week` без истории шаг
  CI → Gate был пустым («out of order: Gate before CI») у 10 Ticket-ов из 17, с историей — ни у
  одного. Без истории (её нет в `--prs` или `gh` не ответил) — `statusCheckRollup`.
- Начало Ticket-а без Autopilot — первый коммит PR (`commits` из `gh`), а не git ветки: ветки после
  merge удаляются. Дата claim из Status без времени даёт пустую ячейку с причиной.
- Репозиторий для `gh`: `--repo`, иначе `origin` из `run-started` этого Epic-а, иначе `origin`
  другого прогона того же Project-а (старые журналы без `origin`), иначе папка `--root` или текущая.
- `--out` внутри журналов, папки данных worfy, `--root` или `~/.claude` (`CLAUDE_CONFIG_DIR`) —
  отказ с exit code 2 (ADR-0005).

**Ручная проверка: отчёт по настоящим журналам Mac для закрытого Epic-а `worfy-week`** (22 файла
журналов, 0 строк пропущено; PR из `gh`; 20 Ticket-ов, данные шагов у 17; 14 — blocked, 19 и 20 —
open, без PR):

| Шаг | Ticket-ов с данными | Сумма | Медиана |
| --- | --- | --- | --- |
| claim → PR | 17 из 20 | 6 h 59 min | 23 min |
| PR → CI | 17 из 20 | 3 h 02 min | 4 min |
| CI → Gate | 17 из 20 | 2 h 28 min | 7 min |
| Gate → merge | 17 из 20 | 1 h 19 min | 5 min |
| Total | 17 из 20 | 13 h 48 min | 52 min |

Критический шаг — **claim → PR** и по сумме, и по медиане: работа исполнителя до открытия PR.
Ожидание Limits — 0 s, кругов доработки (`REJECTED`) — 6 (Ticket-ы 01, 04 — по одному; 11, 18 — по
два), остановок прогона — 0. Самые долгие Ticket-ы: 17 (PR #124, 1 h 19 min), 16 (PR #123,
1 h 12 min). Запуск без аргументов по всем журналам Mac (8 Epic-ов, 104 строки Ticket-ов) — exit 0
за 24 s. Отчёты лежали только в scratchpad, в репозиторий не попали.

**Мутанты** (каждый краснит свой test в `test/unit/critical-path.test.ts`, исходник возвращён из
копии):

| Мутант | Красные test-ы |
| --- | --- |
| перепутать `at`: открытие PR взять из `mergedAt` | 9 из 25, в том числе «measures claim → PR → CI → Gate → merge…» |
| пустая ячейка = 0 | 6, в том числе «leaves a step without data empty with the reason, never zero» |
| писать файл рядом с журналом | 2: «writes only the --out file…», «writes nothing at all without --out» |
| начало ожидания Limits — от `waiting-until`, а не от `limits-hit` | 2, в том числе «counts the Limits wait from limits-hit to resumed…» |
| ручной run (`workflow_dispatch`) считается CI | 3, в том числе «takes CI green at the last successful run…» |
| CI — последний успешный run, без границы Gate | 3, тот же test |
| без проверки `--out` | 1: «refuses an --out inside the journals…» |
| без `origin` из `run-started` | 1: «asks gh for the PR named in the Status…» |
| без `origin` другого прогона Project-а | 1: «asks the repository of a later run…» (26 test-ов) |

**Ограничение:** workflow run-ы сопоставляются с PR только по имени ветки, без `headSha`. Run
ветки с тем же именем, но от другого PR (ветку удалили и создали заново), попадёт в историю CI;
отсекаются только run-ы, закончившиеся раньше открытия PR.

**Круг доработки 1** (вердикт REJECTED в PR #341):

- [med] Отказ `--out` внутри `~/.claude`, журналов или папки данных обходился другим регистром
  букв на диске, нечувствительном к регистру (`--out ~/.CLAUDE/d.md`). Теперь путь сравнивается
  через `realpathSync.native`, он даёт регистр с диска. Test — путь в другом регистре с временными
  HOME и папкой данных; на диске, чувствительном к регистру (Linux CI), test пропускается с
  причиной: там другой регистр — другая папка.
- [low] Висячая symlink в `--out`, указывающая внутрь `~/.claude`, проходила проверку. Теперь
  ссылка без цели разрешается до цели (не больше 40 ссылок подряд). Test создаёт такую ссылку и
  ждёт отказ; где пользователь не может создать symlink (Windows без прав), test пропускается.
- [low] `NARROW: REJECTED` считался кругом доработки. Теперь это вердикт узкого круга
  (`harness/skills/epic-wave/SKILL.md`): `REJECTED` без `NARROW:` — круг доработки, комментарий
  `NARROW: …` — узкий круг; вердикт узкого круга без открывающего комментария — тоже один узкий
  круг.

| Мутант круга 1 | Красный test |
| --- | --- |
| `realpathSync` вместо `realpathSync.native` | «refuses an --out into ~/.claude or the data folder typed in another case…» |
| висячая ссылка не разрешается | «refuses an --out that is a link to a file not yet there inside ~/.claude» |
| `NARROW: REJECTED` снова считается кругом доработки | «counts NARROW: REJECTED as the verdict of the narrow round…» |
| без «вердикт узкого круга = один узкий круг» | тот же test |

**Не проверено:** gate full и Linux CI — после PR, gate full делает оркестратор.
