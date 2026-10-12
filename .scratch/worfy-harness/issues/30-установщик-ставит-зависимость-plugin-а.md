# 30 — Установщик сам ставит зависимость plugin-а `worfy` (`mattpocock-skills`) и не оставляет Harness установленным наполовину

Type: task
Status: done — 2026-10-10, [PR #216](https://github.com/IDSAD-XL/worfy/pull/216)
Blocked by:
Source: решение владельца 2026-10-10 по приёмке E3 (Ticket 26, пункт 1 — песочница с пустым `~/.claude`), вариант а: зависимость ставит сам установщик, в том же диалоге согласия, как qmd с согласия; находка того же прогона — после отказа `claude plugin install` plugin `worfy` записан и включён; [Ticket 13](13-установщик-harness-из-app.md) (установщик; «решено без владельца»: worfy зависимость не ставит); [Ticket 19](19-экран-первого-запуска.md) (экран первого запуска); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md), пункт 7 (что установщик пишет в `~/.claude`); [ADR-0047](../../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md), пункт 5 (plugin объявляет зависимость); [ADR-0043](../../../docs/adr/0043-qmd-is-part-of-harness.md), пункт 4 (скачивание — с согласия); [ADR-0048](../../../docs/adr/0048-harness-plugin-spike-results.md) (команды `claude plugin`); [spec.md](../spec.md)

## Что происходит

- Plugin `worfy` объявляет зависимость `mattpocock-skills@claude-plugins-official`
  (`harness/.claude-plugin/plugin.json:7`; ADR-0047, `docs/adr/0047-…md:67-68`). Без неё Claude Code
  plugin не грузит: в прогоне eval `plugin_errors` — `dependency-unsatisfied`, ни одного правила
  Harness в Session (`27-eval-кейсы-harness-через-plugin-eval.md:228-230`).
- Установщик зависимость не ставит. План установки — две команды для `worfy`: `marketplace add
  <папка>` и `install worfy@worfy-harness --scope user` (`src/main/harness/install.ts:305-309`).
  Зависимости он только читает из `plugin.json` (`dependenciesOf`, `:137-148`) и называет в диалоге
  согласия вместе с командой, которую пользователь должен выполнить сам (`:188-193`). Так решил
  Ticket 13 без владельца (`13-установщик-harness-из-app.md:194-197`).
- Что видел Ticket 13 в песочнице встроенным Claude Code 2.1.289: `install` при неизвестном
  marketplace зависимости — код 0, а `plugin list --json` показывает `worfy` включённым и с
  `errors: ["Dependency … is not installed"]` (`13-…md:187-193`). worfy показывает это как ошибку
  шага `install` (`install.ts:295-296`), но плана у него тогда нет: версии совпадают, `planOf`
  возвращает `null` (`:313`), и кнопка Retry только перечитывает состояние (`:244`).
- Приёмка E3 на пустом `~/.claude` (Ticket 26, пункт 1, `26-приёмка-e3.md:134`) на этом упала:
  зависимости нет, поставить её некому. В том же прогоне `claude plugin install` ответил отказом, а
  plugin `worfy` остался в `installed_plugins.json` и включённым в `settings.json`. Это сообщение
  Orchestrator-а о прогоне; в «Итог» Ticket-а 26 на main оно ещё не записано. Установщик после
  упавшей команды ничего не убирает: цикл команд бросает ошибку шага, и на этом всё (`:247-252`).
- Первая установка читает состояние только при наличии папки plugin-а: без неё `facts()` не зовёт
  `claude` вовсе (`:265-269`), то есть до диалога неизвестно, стоит ли уже зависимость.
- Экран первого запуска показывает одну строку «Harness plugin» из состояния установщика
  (`src/main/first-run/checks.ts:134`, `:268-285`); строки о зависимости нет (список строк —
  `src/shared/ipc/first-run.ts:14-27`). Действие `harness-install` дописывает в диалог «Nothing is
  downloaded: the copy comes from this build» (`src/main/first-run/actions.ts:153`) — с
  зависимостью это станет неправдой. Строки экран рисует общим кодом по отчёту
  (`src/renderer/shell/FirstRun.tsx:121-139`).
- Пункт Harness в toolbar при ошибке советует поставить зависимость руками
  (`src/renderer/shell/toolbar/HarnessStatus.tsx:80-84`).
- Каналы `harness.state`, `harness.install` и `firstRun.run` помечены `'local'`
  (`src/shared/ipc/harness.ts:40`, `:46-51`; `src/shared/ipc/first-run.ts:88-102`): Linked machine
  достаёт только `link` и `project` (`src/shared/ipc/channels.ts:34-38`).
- Marketplace `claude-plugins-official` на машине владельца — GitHub-репозиторий
  `anthropics/claude-plugins-official` (`~/.claude/plugins/known_marketplaces.json`). `plugin
  uninstall worfy@<marketplace> --scope user` — код 0, после него `enabledPlugins` пуст
  (`docs/adr/0048-…md:93-95`).
- Состояние `error` читают ещё два места: перенос старого Harness (`src/main/harness/migrate/plan.ts:488-492`)
  и подключение Project-а (`src/main/projects/connect.ts:223`). Оба смотрят на `kind`, `step` и
  `reason`.

## Что делаем

1. **Новый ADR** (номер выдаёт план Wave; следующий свободный — 0059). Решение: зависимости plugin-а
   `worfy` ставит установщик worfy, с согласия пользователя, командами `claude plugin`; worfy сам
   добавляет только marketplace `claude-plugins-official`. ADR говорит, что уточняет ADR-0040, пункт 7
   (что установщик пишет в `~/.claude`: теперь ещё запись официального marketplace и plugin
   зависимости, обе — через `claude plugin`), и ADR-0047, пункт 5 (кто ставит объявленную
   зависимость), и отменяет «решено без владельца» Ticket-а 13. Принятые ADR не правятся.
2. **Что стоит — до диалога.** `install()` перед планом читает `claude plugin list --json` и при
   отсутствии папки plugin-а (чтение, ничего не пишет); `status()` остаётся прежним: без папки —
   ни одной команды. Из списка берутся запись `worfy@worfy-harness` и записи зависимостей из
   `plugin.json` сборки. Добавлен ли marketplace — по `claude plugin marketplace list --json`; если у
   встроенного Claude Code такой команды нет, `marketplace add` идёт всегда и ответ «уже добавлен» —
   не ошибка. Что из двух — проверить встроенным бинарём в песочнице и записать в «Итог».
3. **План: сначала зависимость, потом `worfy`.** Для каждой зависимости, которой нет в списке:
   `claude plugin marketplace add anthropics/claude-plugins-official` (если marketplace не добавлен)
   и `claude plugin install mattpocock-skills@claude-plugins-official --scope user`. Затем копия
   Harness и прежние команды `worfy`. Источник marketplace — константа в `install.ts`: одно имя
   `claude-plugins-official` и его репозиторий. Зависимость без marketplace в имени или из другого
   marketplace worfy не ставит: ошибка шага с её именем, остальное не запускается. Зависимость уже
   стоит — её команд в плане нет.
4. **Диалог согласия — один.** Вместо абзаца «install it with…» (`install.ts:188-193`): какие
   команды пойдут для зависимости, что Claude Code скачает её из GitHub
   (`anthropics/claude-plugins-official`) и запишет marketplace и plugin в свои настройки. Строка
   «Nothing is downloaded» в действии экрана первого запуска (`actions.ts:153`) остаётся только для
   плана без команд зависимости. Отказ в диалоге — ни одной записи и ни одной команды, кроме чтения
   списка из шага 2.
5. **Конец установки — одно из двух состояний, без «наполовину».**
   - Шаг зависимости упал (`marketplace add` или `install`): копия Harness не делается, команды
     `worfy` не идут. Состояние — `error` с шагом `dependency marketplace add` или `dependency
     install` и хвостом stderr; в `plugin list` записи `worfy` нет.
   - Первая установка `worfy` упала (код не 0): установщик перечитывает `plugin list`; если запись
     `worfy` появилась — `claude plugin uninstall worfy@worfy-harness --scope user`. Состояние —
     `error` шага `install`, в причине сказано, что запись убрана; если упал и `uninstall` — оба
     хвоста stderr и шаг `uninstall`. Упавший `update` ничего не удаляет: прежняя версия остаётся.
   - `worfy` стоит, а зависимости нет (старое состояние из Ticket-а 13; зависимость удалили позже;
     `install` вернул 0 с `errors`): состояние — `error` шага `dependency install` с именем
     зависимости, и у него есть план — только команды зависимости. Retry теперь её ставит, а не
     только перечитывает состояние.
   Новых `kind` у состояния нет: добавляются шаги `dependency marketplace add`, `dependency install`,
   `uninstall` (`src/shared/ipc/harness.ts:10`). Перенос старого Harness и подключение Project-а
   читают `error` как раньше.
6. **Статус зависимости — в `HarnessStatus`**: поле `dependencies` — имя и «стоит / нет / не
   проверено» (не проверено — пока нет папки plugin-а, шаг 2). Берётся из того же `plugin list`,
   лишней команды нет.
7. **Экран первого запуска** — новая строка в группе Harness после «Harness plugin»: id
   `harness-dependencies`, название «Plugin dependencies». `ok` — имя и версия; `fail` — «not
   installed» и кнопка «Install…» (то же действие `harness-install`: план из одних команд
   зависимости); `warn` без кнопки — «checked when the Harness plugin is installed». В
   `docs/design/F-SPEC.md`, «First run» — строка в списке группы (`:104`) и кнопка (`:112`). Снимки
   экрана в двух темах — как у Ticket-а 19.
8. **Toolbar**: подсказка у Retry (`HarnessStatus.tsx:84`) больше не просит ставить зависимость
   руками: Retry ставит то, что осталось.
9. **Linked machine.** Новых каналов нет; `harness.install` и `firstRun.run` остаются `'local'` —
   это держит test.

**Не входит:** своя копия `mattpocock-skills` внутри `.app`; обновление зависимости до новой версии;
удаление зависимости при удалении `worfy`; правка `scripts/eval-harness.mjs`, который гоняет копию
Harness без `dependencies` (Ticket 27); прогон приёмки — Ticket 26.

## Готово, когда

Все test-ы — со stub-ом `claude`, во временных `HOME`, `CLAUDE_CONFIG_DIR` и `WORFY_CLAUDE_HOME`, без
сети и без настоящего Claude Code.

- [x] contract `test/contract/harness-install.test.ts`, пустая песочница, согласие дано: вызовы
  stub-а по порядку — `plugin list --json`, `plugin marketplace add anthropics/claude-plugins-official`,
  `plugin install mattpocock-skills@claude-plugins-official --scope user`, `plugin marketplace add
  <папка>`, `plugin install worfy@worfy-harness --scope user`; состояние — `installed`, в
  `dependencies` — «стоит».
- [x] contract: отказ в диалоге — в логе stub-а только `plugin list --json`; в песочнице не появилось
  ни одного файла; исход `declined`.
- [x] contract: зависимость уже в `plugin list` — в плане и в логе нет ни `marketplace add` для
  `claude-plugins-official`, ни `install mattpocock-skills…`; диалог её команд не называет.
- [x] contract: `marketplace add` официального marketplace упал — состояние `error`, шаг `dependency
  marketplace add`, в причине хвост stderr; папки `<harnessHome>/plugin` нет; `install` для
  `worfy` не вызывался.
- [x] contract: `install` зависимости упал — состояние `error`, шаг `dependency install`; папки
  `<harnessHome>/plugin` нет; команды `worfy` не вызывались; повтор с исправным stub-ом доводит до
  `installed`, `marketplace add` официального marketplace второй раз не идёт (или идёт и не ошибка —
  по ответу шага 2).
- [x] contract: stub записывает `worfy` и выходит с кодом не 0 (как в приёмке) — в логе после
  `install` есть `plugin uninstall worfy@worfy-harness --scope user`; в состоянии stub-а записи
  `worfy` нет; состояние — `error` шага `install`. Тот же случай с упавшим `uninstall` — шаг
  `uninstall`, оба хвоста stderr в причине.
- [x] contract: `worfy` стоит с версией сборки, зависимости нет (`errors` в `plugin list`) —
  состояние `error` шага `dependency install`; `install()` показывает диалог с одними командами
  зависимости и после согласия даёт `installed`. Упавший `update` — `uninstall` не вызывался.
- [x] contract: зависимость `x@чужой-marketplace` в `plugin.json` сборки — ошибка с её именем, ни
  одной команды записи.
- [x] contract: текст диалога с командами зависимости называет `anthropics/claude-plugins-official`
  и скачивание; «Nothing is downloaded» в нём нет. Без команд зависимости — прежний текст.
- [x] contract: `accessOf('harness.install')` и `accessOf('firstRun.run')` (`src/shared/ipc/channels.ts:95`) — `'local'`, оба
  не входят в `LINKED_MACHINE_ACCESS`.
- [x] contract `test/contract/first-run-checks.test.ts`: строка `harness-dependencies` — `fail` с
  кнопкой `harness-install` «Install…», когда `worfy` стоит без зависимости; `ok` с версией, когда
  стоит; `warn` без кнопки, когда plugin-а нет. Порядок строк группы Harness: `harness`,
  `harness-dependencies`, `legacy-harness`.
- [x] unit `test/unit/harness-status.test.tsx`: при `error` шага `dependency install` подсказка
  Retry не содержит `claude plugin install`.
- [x] e2e `test/e2e/harness-install.spec.ts` и `test/e2e/first-run.spec.ts` (stub `WORFY_CLAUDE`):
  установка с пустой песочницы проходит одним диалогом, в нём команды зависимости; на экране
  первого запуска строка «Plugin dependencies» — «OK». Снимки строки в двух темах — в
  `.scratch/worfy-harness/evidence/30-*.png`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0.
- [x] `GATE_SCOPE=all gate.sh full` на ветке после rebase — код 0 и вердикт Gate «зелено»; e2e и
  `.app` проверяются только здесь, под замком `/tmp/worfy-e2e.lock`.
- [ ] Ticket 26 получает `Blocked by: …, 30` (правка его файла — в PR этого Ticket-а).
  не проверено: правку файла Ticket-а 26 делает исполнитель Ticket-а 26 в PR #211 (файл занят этим PR).
- [ ] После мержа, не в CI: `pnpm test:acceptance -g "sandbox"` Ticket-а 26 на пустой песочнице —
  код 0. Запускает Orchestrator или владелец; это первая проверка с настоящим Claude Code и сетью.
  не проверено: шаг после мержа; исполнителю настоящий Claude Code и сеть запрещены.

## Тесты

Сначала падающий test — `test/contract/harness-install.test.ts`, случай «пустая песочница: зависимость
ставится перед `worfy`». На main в плане только две команды `worfy` (`install.ts:305-309`) — test
красный: в логе stub-а нет `install mattpocock-skills…`. В «Итог» — как он падал.

- `test/contract/harness-install.test.ts` — stub (`:77-100`) учится: помнить несколько marketplace и
  plugin-ов, `plugin uninstall`, отказ по полной команде с именем plugin-а, «записал и вышел с кодом
  не 0». Случаи — из «Готово, когда». Последний случай файла (настоящий бинарь SDK на macOS, сеть
  закрыта, `:509-542`) остаётся: с закрытой сетью он теперь ждёт `error` шага зависимости и
  отсутствие записи `worfy`.
- `test/contract/first-run-checks.test.ts` и stub `test/fixtures/first-run-tools/claude` — строка
  зависимости.
- `test/unit/harness-status.test.tsx` — подсказка Retry.
- `test/e2e/harness-install.spec.ts`, `test/e2e/first-run.spec.ts` — диалог и строка, локально в
  gate full.
- Приёмка с настоящим Claude Code — Ticket 26, после мержа.

## Где в коде

- `docs/adr/NNNN-installer-installs-plugin-dependencies.md` — новый; номер выдаёт план Wave
- `src/main/harness/install.ts`
- `src/shared/ipc/harness.ts`
- `src/main/first-run/checks.ts`
- `src/main/first-run/actions.ts`
- `src/shared/ipc/first-run.ts`
- `src/renderer/shell/toolbar/HarnessStatus.tsx`
- `docs/design/F-SPEC.md`
- `test/contract/harness-install.test.ts`
- `test/contract/first-run-checks.test.ts`
- `test/fixtures/first-run-tools/claude`
- `test/unit/harness-status.test.tsx`
- `test/e2e/harness-install.spec.ts`
- `test/e2e/first-run.spec.ts`
- `.scratch/worfy-harness/issues/26-приёмка-e3.md`

## Итог

Сделано в ветке `worfy-harness/30`, PR #216. Решение — [ADR-0059](../../../docs/adr/0059-installer-installs-plugin-dependencies.md).

- **Что стоит — до диалога.** `install()` читает `claude plugin list --json` и без папки plugin-а
  (`src/main/harness/install.ts`, `facts(true)`); `status()` прежний: без папки — ни одной команды. Из одного
  списка берутся запись `worfy@worfy-harness` и записи зависимостей из `plugin.json` сборки. Если зависимости
  не хватает, читается ещё `claude plugin marketplace list --json` (тоже чтение).
- **План и порядок.** `InstallPlan` получил `dependencies` (чего не хватает) и `dependencyCommands`; они идут
  первыми, до копии Harness: `marketplace add anthropics/claude-plugins-official` (если marketplace не известен)
  и `install <имя>@claude-plugins-official --scope user`. Имя и репозиторий marketplace — константы
  `DEPENDENCY_MARKETPLACE` и `DEPENDENCY_MARKETPLACE_SOURCE`. Зависимость из другого marketplace или без
  marketplace в имени, которой нет в списке, — ошибка шага `dependency install` с её именем до диалога, без
  единой команды записи; если она уже стоит — ничему не мешает.
- **Диалог один** (`confirmationText`): команды зависимости, «Claude Code downloads it from GitHub
  (anthropics/claude-plugins-official) and records the marketplace … and the plugin», затем копия и команды
  `worfy`. Абзаца «install it with…» больше нет. Когда не хватает одной зависимости — заголовок «Install <имя>
  for the worfy Harness?» и только её команды. Строка «Nothing is downloaded» в действии экрана первого запуска
  остаётся только у плана без команд зависимости (`src/main/first-run/actions.ts`). Отказ — в логе stub-а два
  чтения (`plugin list --json`, `plugin marketplace list --json`), в песочнице ни одного нового файла.
- **Без «наполовину».** Шаг зависимости упал — копии Harness нет, команд `worfy` нет, состояние `error` шага
  `dependency marketplace add` или `dependency install` с хвостом stderr. Первая установка `worfy` упала —
  установщик перечитывает `plugin list` и, если запись появилась, вызывает `claude plugin uninstall
  worfy@worfy-harness --scope user`; причина говорит, что запись убрана; упал и `uninstall` — шаг `uninstall` и
  оба хвоста. Упавший `update` ничего не удаляет. `worfy` стоит, зависимости нет — `error` шага `dependency
  install` с именем, и у него есть план из одних команд зависимости: Retry её ставит. Новых `kind` нет; шаги
  `dependency marketplace add`, `dependency install`, `uninstall` добавлены в `src/shared/ipc/harness.ts`.
  Перенос старого Harness и подключение Project-а читают `error` как раньше.
- **Статус зависимости.** `HarnessStatus.dependencies` — `{ id, status: installed | missing | unchecked,
  version }`, из того же `plugin list`.
- **Экран первого запуска.** Строка `harness-dependencies` «Plugin dependencies» после «Harness plugin»: `ok` —
  имя и версия; `fail` — «not installed», подсказка называет зависимость, кнопка «Install…» (действие
  `harness-install`); `warn` без кнопки — «checked when the Harness plugin is installed». Обе строки группы
  читают состояние установщика один раз. Упавший шаг зависимости показывается на строке зависимостей, не на
  строке plugin-а. `docs/design/F-SPEC.md`, «First run» — обновлён.
- **Toolbar.** Подсказка Retry: «Retry reads the state again and runs what is left of the install, a missing
  dependency of the plugin included; the dialog names every command before anything runs».
- **Linked machine.** Новых каналов нет; `harness.install` и `firstRun.run` остаются `local`, test держит
  (`test/contract/harness-install.test.ts`, «a Linked machine»).

**Красный test первым.** `test/contract/harness-install.test.ts`, «an empty sandbox: the dependency is installed
before worfy…» на main-коде установщика падал так: `AssertionError: expected [] to deeply equal [ 'plugin list
--json', 'plugin marketplace list --json' ]` — к моменту диалога установщик не прочитал ничего (на main без папки
plugin-а `facts()` не зовёт `claude`), а в плане были только две команды `worfy`.

**Mutation testing** (скрипт `mutants.py` в scratchpad исполнителя, файлы восстанавливаются из копий):
23 мутанта, каждый — одно поведение Ticket-а; 22 красные, один оказался эквивалентным и убран из кода.
Красные: копия Harness раньше команд зависимости; нет `uninstall` после упавшей первой установки; запись после
отказа не ищется; `install()` не читает список без папки; `status()` читает список без папки; `worfy` без
зависимости считается установленным; зависимость чужого marketplace ставится; «already» с ненулевым кодом —
ошибка; упавший `update` вызывает `uninstall`; marketplace добавляется, хотя известен; причина непрочитанного
списка marketplace-ов теряется; зависимость, поставленная до сбоя, остаётся «нет»; в диалоге нет строки о
скачивании; «Nothing is downloaded» всегда; строка зависимости — `warn` вместо `fail`; без кнопки; без имени
зависимости; «не проверено» читается как `ok`; сбой шага зависимости попадает на строку plugin-а; удачная
попытка не снимает сбой со строки зависимостей; подсказка Retry снова велит ставить руками. Эквивалентный:
условие «первая установка» у `uninstall` — команда `install` и так планируется только когда Claude Code plugin
не числит; условие удалено.

**Снимки** (Playwright, обе темы): `worfy` стоит без зависимости —
[светлая](../evidence/30-first-run-dependency-missing-light.png),
[тёмная](../evidence/30-first-run-dependency-missing-dark.png); после «Install…» —
[светлая](../evidence/30-first-run-dependency-installed-light.png),
[тёмная](../evidence/30-first-run-dependency-installed-dark.png); первый старт (строка «Warning», пока plugin
не стоит) — [светлая](../evidence/30-first-run-light.png), [тёмная](../evidence/30-first-run-dark.png); toolbar
после упавшего шага зависимости — [светлая](../evidence/30-toolbar-dependency-error-light.png),
[тёмная](../evidence/30-toolbar-dependency-error-dark.png). Нативный диалог Playwright снять не может — его
текст, как его получил main: [вся установка](../evidence/30-dialog-install.txt),
[одна зависимость](../evidence/30-dialog-dependency.txt).

**Проверки.** `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0 (182 файла, 3697 test-ов прошли, 6 пропущены). `GATE_SCOPE=all gate.sh fast` —
код 0, «[gate] зелено (fast): worfy/.:lint worfy/.:typecheck worfy/.:test». `GATE_SCOPE=all gate.sh full` под замком `/tmp/worfy-e2e.lock` — код 0, «[gate] зелено (full): worfy/.:lint worfy/.:typecheck worfy/.:test worfy/.:test:e2e worfy/.:test:package» на commit `7a8bd43`; после него в ветку добавлен только этот «Итог». CI PR #216 на том же commit — `check` зелёный.

**Вынужденные правки вне следа** (разрешил Orchestrator 2026-10-10): `test/e2e/select.spec.ts`,
`test/e2e/projects-connect.spec.ts`, `test/e2e/harness-migrate.spec.ts` — stub `claude` в `plugin list --json`
печатает вторую запись, `mattpocock-skills@claude-plugins-official` (иначе с собранным `out/harness` состояние —
`error` шага `dependency install`, а не `installed`); `test/contract/projects-connect.test.ts`,
`test/unit/harness-migration-form.test.tsx` — литерал `HarnessStatus` получил `dependencies: []`;
`test/fixtures/first-run-tools/README.md` — описание stub-а. Других stub-ов `claude plugin list` в `test/` нет
(grep по `plugin list`: кроме названных — файлы следа). `test/acceptance/*` (PR #211) не тронут: его stub и
spec нужно проверить после мержа обоих PR.

**Решено без владельца, подтверждено владельцем 2026-10-12 (пункты 2–8).**

1. Случай с настоящим бинарём Claude Code из SDK (`test/contract/harness-install.test.ts`, последний) оставлен,
   но на копии Harness без `dependencies`: настоящий бинарь выполняет те же локальные команды, что на main
   (`marketplace add <папка>`, `install worfy@worfy-harness`, `plugin list --json`), и не тянется к удалённому
   marketplace. Тикет просил, чтобы этот случай ждал ошибку шага зависимости; с закрытым HTTPS-прокси нет
   гарантии, что git не пойдёт по ssh, а сеть в test-ах запрещена.
   **Подтверждено владельцем 2026-10-10;** настоящую установку зависимости покрывает пункт 1
   приёмки E3 (`worfy-harness` 26).
2. Отказ в диалоге оставляет в логе два чтения, а не одно: `plugin marketplace list --json` читается до диалога,
   чтобы диалог называл ровно те команды, что пойдут (пункт 2 тикета это допускает, критерий называл одно).
3. Если `plugin marketplace list --json` отвечает ошибкой или не списком записей с `name`, marketplace
   добавляется всегда; ненулевой ответ `marketplace add` со словом «already» — не ошибка; упавший `marketplace
   add` дописывает в причину, почему список не прочитан.
4. На экране первого запуска строка при отсутствии зависимости пишет «not installed», а имя зависимости — в
   подсказке: вместе с именем текст обрезался кнопкой «Install…».
5. Упавший шаг зависимости показывается «The last attempt failed…» на строке «Plugin dependencies», а не на
   строке «Harness plugin».
6. Командам, которые скачивают (`marketplace add` официального marketplace, `install` зависимости), дан предел
   10 минут вместо 2: это клон репозитория с GitHub.
7. `install()` без папки plugin-а теперь читает список: если Claude Code ещё числит `worfy` (папку удалили
   руками), план — копия и, при другой версии, `update`, без повторных `marketplace add` и `install`.
8. Состояние «`worfy` стоит, зависимости нет» даёт на экране первого запуска две строки «Failed» (plugin с
   Retry и зависимости с «Install…») — обе запускают одно действие.

**Не проверено.**

- Адрес официального marketplace (`anthropics/claude-plugins-official`, из `known_marketplaces.json` машины
  владельца) и наличие у настоящего Claude Code команды `claude plugin marketplace list --json` с ответом
  «список записей с `name`» — настоящий бинарь с зависимостью не запускался (запрет брифа: сеть, настоящий
  `~/.claude`). Проверит приёмочный прогон Ticket-а 26 в песочнице после мержа.
- Что настоящий `claude plugin install worfy@…` после поставленной зависимости проходит, что запись,
  оставленная отказом, видна в `plugin list --json` и снимается `plugin uninstall` — то же, Ticket 26.
- Пункт «После мержа, не в CI: `pnpm test:acceptance -g "sandbox"`» — запускает Orchestrator или владелец.
- Пункт «Ticket 26 получает `Blocked by: …, 30`» в этом PR не делается: файл Ticket-а 26 правит открытый
  PR #211, строку добавляет исполнитель Ticket-а 26 там.

### Gate оркестратора (2026-10-10)

- Круг 1 — `VERIFIED` ([комментарий в PR #216](https://github.com/IDSAD-XL/worfy/pull/216#issuecomment-6093137280)). Долги:
  - [low] `src/main/harness/install.ts:340` — любой сбой `marketplace add` со словом «already» в выводе считается успехом (после прерванного клона настоящая причина теряется).
  - [low] `install.ts:55`, `src/renderer/shell/FirstRun.tsx:207`, `:296` — предел 10 минут не закреплён test-ом; пока действие идёт, экран первого запуска не закрывается ни Close, ни Esc (зависший клон — до 20 минут без отмены).
  - [low] `install.ts:466`, `src/main/first-run/checks.ts:288`, `src/main/projects/connect.ts:231` — с текстом настоящего Claude Code строка Harness и отказ подключения Project-а могут советовать ставить зависимость руками.
  - [low] ссылка в ADR-0059 п. 7 на «ADR-0052, пункт 6» неточна (пометка `local` — Ticket `worfy-link` 08); критерии `:115-121` говорят об одном чтении, их два.
- В приёмку Ticket-а 26: настоящий Claude Code с зависимостью; пишут ли два чтения до диалога (`plugin list`, `plugin marketplace list`) что-нибудь в пустой Claude home.
- Мерж: rebase на `b17dfc1`, `GATE_SCOPE=all gate full` — код 0 с первого прогона, CI зелёный, CLEAN, влит `e0b04d1`.
