# 08 — Редактор Pipeline Project-а в Settings

Type: task
Status: done 2026-10-20T03:01Z
PR: #552
Blocked by: 03, 06
Source: решение владельца 2026-10-17, grilling о Pipeline, пункт 10 ([spec.md](../spec.md), «Решения
владельца»: сначала Pipeline правится в `profile.json` руками или через `bin/profile`, редактор в
Settings — поздний Ticket); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md);
решение владельца 2026-10-19, Q-f — вариант (b): поле пишет отдельный скрипт Harness `bin/profile-set`
([ADR-0073](../../../docs/adr/0073-profile-set-writes-the-pipeline.md)); Q10 — делает Session на Mac после
мержа #517, #496 и #508 — условие выполнено, все три влиты (`16931520`, `2e8fb988`, `b0d6f636`);
решения владельца 2026-10-20, grilling Q1–Q16 (здесь Q1–Q8; [spec.md](../spec.md), «Решения владельца»,
блок 2026-10-20).

## Что происходит

- Pipeline — поле `workflow.pipeline` в `profile.json` Profile-а, вне репозитория
  (`~/.claude/worfy-harness/projects/<name>/`). Проверяет его `bin/profile` (Ticket 02); `bin/profile`
  только читает (`harness/bin/profile:25`).
- Правила Pipeline живут внутри `bin/profile`: `STAGE_KINDS`, `DEFAULT_PIPELINE`, `STAGE_FIELDS` и
  `pipelineOf` (`harness/bin/profile:419-455`). Нарушение — `die(1, …)` на верхнем уровне скрипта
  (`:425`): функцию нельзя позвать из другого скрипта, не завершив его. Общего модуля у скриптов
  `harness/bin/` нет; образец общего кода — `harness/hooks/eval-env.cjs`, его берёт
  `harness/bin/wave-gate:99` (`require("../hooks/eval-env.cjs")`). Сборка worfy копирует в приложение весь
  `harness/`, кроме `tests/` и `evals/` (`electron.vite.config.ts:11-12`): новая папка `harness/lib/` уедет
  в plugin сама.
- Те же правила в worfy — zod-схема `pipelineSchema` (`src/shared/workflow/pipeline.ts:28-66`). Поля
  мягче, чем в Harness: `stuck_after` — `^\d+[hm]$` (пропускает `0h`, у Harness `^[1-9]\d*[hm]$`),
  `label` и `environment` — `min(1)` (пропускают строку из пробелов, Harness — нет).
- Settings worfy — разделы `src/renderer/settings/*Section.tsx`; `sections.ts` находит файлы сам
  (`import.meta.glob`, `src/renderer/settings/sections.ts:35`), правки там не нужно.
- worfy меняет workflow только инструментами Harness (ADR-0002). Так же пишет Profile `bin/project-connect`:
  проверка по схеме, запись, commit в git папки Harness (`harness/bin/project-connect:443-467`); при сбое
  commit-а он откатывает всё. worfy зовёт его из main через общий запуск скриптов Harness
  (`src/main/projects/connect.ts:33-34`).
- Каналы IPC: `pipeline.get` и `pipeline.close` — `project`, `read` (`src/shared/ipc/pipeline.ts:48-54`).
  Канал `project` помечен `read` или `write` (ADR-0066, пункт 3); `write` при доступе Read only получает
  отказ в `LinkIpcAdapter.call`. Канал `local` закрыт Linked machine при любом уровне доступа, Full access
  тоже (`src/shared/ipc/channels.ts:30-31`, `LINKED_MACHINE_ACCESS` — `:38`): адаптер отвечает
  «`<канал>: not open to Linked machines`» (`src/main/link/ipc-adapter.ts:54`, `:234`). preload общий и
  списка каналов не знает (`src/preload/index.ts:1-3`, ADR-0006) — его не править.
- Кнопка обновления Harness в toolbar — `HarnessStatus` (`src/renderer/shell/toolbar/HarnessStatus.tsx:80`,
  действие `Update Harness`). Иконка вместо текста — `worfy-ui` 18, PR #543; на 2026-10-20 он открыт.
- Где plugin Harness: `src/main/harness/locate.ts:68-74` (`<harnessHome>/plugin/bin`).
- **Платформенный PR** (ADR-0073): Ticket добавляет скрипт Harness (ADR-0056, пункт 2). Вердикт Windows — полный
  run на Windows-runner-е, если PR не трогает Terminal, окна, e2e и упаковку (ADR-0071, пункт 3); до мержа
  `worfy-windows` 66 — gate full на ПК. После мержа — `pnpm install:stable` (ADR-0047).

## Что делаем

1. **Общий модуль правил (Q1).** `harness/lib/pipeline.cjs` — каталог видов, `DEFAULT_PIPELINE` и проверка
   Pipeline; проверка возвращает причину, а не завершает процесс. `bin/profile` и `bin/profile-set` берут
   правила только из него (`require("../lib/pipeline.cjs")`); `bin/profile` превращает причину в прежний
   `die(1, "<profile.json>: workflow.pipeline… — broken profile")`, текст причин не меняется. CommonJS, а не
   `.mjs`: `bin/profile` — CommonJS (`"use strict"`, `require`), как и образец `eval-env.cjs`. Там же —
   отпечаток Pipeline (п. 4).
2. **`harness/bin/profile-set`** (новый, Node, ADR-0055): пишет только `workflow.pipeline` в `profile.json`
   Profile-а одного Project-а (Project — как у `bin/profile -C <root>`). Остальные поля не трогает.
   `bin/profile` остаётся только читающим (`harness/bin/profile:25`).
   - Неверный Pipeline не пишется: exit 1 с причиной из общего модуля.
   - **Сброс (Q4):** режим, который удаляет поле `workflow.pipeline`; дальше действует `DEFAULT_PIPELINE`.
     ADR-0073 о сбросе молчит; это решение владельца 2026-10-20 его дополняет, ADR не правится.
   - **Commit (Q7):** после записи — commit в git папки Harness, как у `bin/project-connect`. Если git нет
     или commit не прошёл, запись остаётся (в отличие от `project-connect`, который откатывает всё):
     exit 0 и предупреждение с причиной отдельной строкой вывода. Commit — история, не условие.
   - **Compare-and-write (Q6):** вызов передаёт отпечаток Pipeline, который редактор прочитал. Скрипт
     считает отпечаток значения `workflow.pipeline` в файле сейчас (поля нет — отпечаток `null`); не
     совпал — ничего не пишет и выходит своим кодом, отличным от 1. Форма отпечатка — выбор implementer-а,
     одна функция в `harness/lib/pipeline.cjs`.
3. **Раздел Settings «Pipeline»** для выбранного Project-а этой Machine: виды из каталога ADR-0067 —
   включить, переставить, переименовать (`label`), задать `stuck_after`, `name` у Check и `environment` у
   Deploy. Своих видов и выражений нет. Кнопки `Save` и `Reset to default`.
   - **Проверка полей до записи (Q2):** каждое поле — по тем же правилам: вид Stage, `label`,
     `stuck_after` вида `2h`, `name` обязателен у Check, `environment`. Источник — `pipelineSchema`; его
     поля приводятся к правилам Harness (`stuck_after` — `^[1-9]\d*[hm]$`, `label` и `environment` — не
     пустые после trim). Причина exit 1 скрипта показывается, если форма что-то пропустила.
   - **Смена Pipeline не блокируется (Q3).** Под `Save` одна строка: Stage каждого Ticket-а будет посчитан
     заново. Удаление Check, по которому уже есть отметки, спрашивает подтверждение и называет число
     затронутых Ticket-ов. Это число — из снимка `pipeline.get`: Ticket-ы в работе (`claimed`, `blocked`;
     только у них есть факты отметок, `src/main/workflow/stages.ts:13`), у которых `check/<name>` в
     `passed` или текущий Stage — `check/<name>`.
   - **Сброс (Q4):** `Reset to default` спрашивает подтверждение и зовёт режим сброса `bin/profile-set`.
   - **Конфликт (Q6):** ответ «отпечаток не совпал» — строка «Pipeline изменился, перечитайте» и кнопка
     `Reload`, которая читает Pipeline заново. Правки формы при этом не пишутся.
   - **Commit не прошёл (Q7):** запись принята, раздел показывает предупреждение с причиной.
   - **Старый Harness (Q8):** в plugin нет `bin/profile-set` — раздел показывает «Harness слишком старый
     для редактора Pipeline» и кнопку `Update Harness` из toolbar (тот же компонент `HarnessStatus`; если
     PR #543 ещё не влит — кнопка в нынешнем виде, без иконки). Форма не показывается.
4. **Запись только на этой Machine (Q5).** Запись из worfy — новый канал IPC `local` (не `project`/`write`)
   в `src/shared/ipc/pipeline.ts`: main отказывает в нём любой Linked machine, и с Full access тоже, а не
   только интерфейс его прячет. Обработчик в `src/main/ipc/pipeline.ts` зовёт `bin/profile-set` общим
   запуском скриптов Harness, как `connect.ts`; renderer файл не пишет. Чтение Pipeline для формы
   (значение поля, отпечаток, есть ли `bin/profile-set`) — канал `project`, `read`: им окно Linked machine
   показывает Pipeline её Project-а. Project
   Linked machine (окно показывает Linked machine, `windowMachine()`, `src/renderer/ipc.ts:154`): раздел
   показывает Pipeline только для чтения и строку, где его править — в worfy на той Machine.

## Готово, когда

- [x] Решение владельца об инструменте записи — Q-f (b), [ADR-0073](../../../docs/adr/0073-profile-set-writes-the-pipeline.md).
- [x] Решения владельца о форме, сбросе, конфликте, commit-е и Linked machine — 2026-10-20, Q1–Q8.
- [ ] Правила Pipeline — один модуль `harness/lib/pipeline.cjs`; `grep -n "STAGE_KINDS = \|function pipelineOf" harness/bin/profile harness/bin/profile-set`
      ничего не находит. `harness/bin/tests/profile.test.sh` — exit 0 без правки ожидаемых причин.
- [ ] Test `bin/profile-set` во временной `HARNESS_HOME`: верный Pipeline записан и закоммичен, прочие поля
      `profile.json` не изменились; неверный — exit 1, файл и история git прежние; чужой отпечаток — свой код
      выхода, файл прежний; сброс — поля нет, `bin/profile --json` даёт `_resolved.pipeline` по умолчанию;
      git без репозитория папки Harness или с ошибкой commit-а — exit 0, файл записан, предупреждение в
      выводе. Красный до скрипта.
- [ ] `pnpm test test/unit/settings-pipeline.test.tsx` — exit 0: включение, порядок, переименование;
      неверное поле (`stuck_after: 0h`, Check без `name`, пустой `label`) — ошибка у поля, вызова записи нет;
      причина exit 1 видна; удаление Check с двумя затронутыми Ticket-ами — подтверждение с числом 2;
      `Reset to default` — подтверждение, затем вызов сброса; конфликт — строка и `Reload`; предупреждение
      commit-а; без `bin/profile-set` — текст о старом Harness и кнопка `Update Harness`; Project Linked
      machine — без кнопок записи и со строкой, где править.
- [ ] `test/unit/link-access.test.ts` — новый канал записи в списке `local`, канал чтения — `project`, `read`.
- [ ] `test/contract/link-access.test.ts` — exit 0: вызов канала записи от Linked machine с Full access —
      отказ «`<канал>: not open to Linked machines`», `bin/profile-set` (stub) не запущен, `profile.json`
      прежний; тот же вызов из окна этой Machine доходит до обработчика.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.

## Тесты

Сначала падающие `harness/bin/tests/profile-set.test.sh` и `test/unit/settings-pipeline.test.tsx`; раздел
Settings пишет через stub `bin/profile-set` во временной папке `HARNESS_HOME`. Сбой commit-а — git без
репозитория в `HARNESS_HOME` или stub `git` в `PATH`, который на `commit` выходит с 1. `profile.test.sh`
не меняется: он доказывает, что перенос правил в общий модуль не изменил причины.

## Где в коде

- `harness/lib/pipeline.cjs` (новый) — каталог видов, `DEFAULT_PIPELINE`, проверка, отпечаток
- `harness/bin/profile` — правила Pipeline из общего модуля
- `harness/bin/profile-set` (новый)
- `harness/bin/tests/profile-set.test.sh` (новый; `test/contract/harness-scripts.test.ts:29-35` берёт все `*.test.sh` сам)
- `harness/profiles/README.md` — строка о `bin/profile-set` у поля `workflow.pipeline`
- `src/shared/workflow/pipeline.ts` — поля `pipelineStageSchema` по правилам Harness
- `src/shared/ipc/pipeline.ts` — каналы чтения и записи и их типы
- `src/main/ipc/pipeline.ts` — обработчики: чтение поля и отпечатка, вызов `bin/profile-set`
- `src/renderer/settings/PipelineSection.tsx` (новый)
- `test/unit/settings-pipeline.test.tsx` (новый)
- `test/unit/link-access.test.ts` — новые каналы в поимённых списках (запись — `local`)
- `test/contract/link-access.test.ts` — отказ записи Linked machine с Full access

## Итог

Решение владельца 2026-10-19 (Q-f): вариант (b) — отдельный скрипт `bin/profile-set`,
[ADR-0073](../../../docs/adr/0073-profile-set-writes-the-pipeline.md). Решения владельца 2026-10-20 (Q1–Q8) —
в «Что делаем». Остальное заполняется при закрытии.

Влит PR #552 (`7d3457c7`), 2026-10-20. Известное ограничение: Pipeline, сломанный руками в `profile.json`, из
редактора не сбросить.
