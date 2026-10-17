# 46 — Имя `gate.sh` уходит совсем: перенос пишет `node … gate.mjs`, установщик правит перенесённые Profile-ы, shim удаляется

Type: task
Status: done 2026-10-14
Blocked by: 03
Source: решение владельца 2026-10-13 («пока пусть Б»: `gate.sh` пока остаётся файлом из двух строк, который запускает `gate.mjs`; полное удаление имени — отдельным Ticket-ом после приёмки E3); [Ticket 03](03-gate-на-node.md) (Gate на Node), «Что делаем», пункты 1, 8 и 9; [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node», пункты 1 и 4; [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md), пункты 5 и 7 — что установщик пишет на машине; [Ticket 26 Epic-а `worfy-harness`](../../worfy-harness/issues/26-приёмка-e3.md) — приёмка E3

> **Закрыт 2026-10-14 без работы: цель отменена решением владельца.** `gate.sh` остаётся точкой
> входа hook-ов Gate — файлом запуска, который находит node и без node сам отвечает «проверить не
> удалось» (PR #298, Ticket 03). Убрать имя совсем нельзя, а пункты 1–3 были нужны только для
> удаления файла. Разбор — в «Итог». Текст ниже — Ticket, каким он был до этого решения.

## Что происходит

- **Gate** — скрипт Harness: запускает проверки Project-а и пишет вердикт. Сейчас это
  `harness/hooks/gate.sh` на bash. Harness — plugin `worfy` для Claude Code из папки `harness/`.
- **Ticket 03** (Gate на Node; в работе на Windows-ПК владельца, не влит) заменяет его на
  `harness/hooks/gate.mjs`. Основание — ADR-0055 (скрипты Harness — на Node, bash только в
  test-ах; пункты 1 и 4). В тексте Ticket-а 03 на main `376e4b10` `gate.sh` удаляется («Что
  делаем», пункт 1), а `git grep -n 'gate\.sh' -- harness` пуст (пункт 8 и строка «Готово, когда»).
- **Что нашлось по ходу: имя файла записано в Profile-ах на машине.** Profile — настройки
  Project-а в `~/.claude/worfy-harness/projects/<имя>/`: `profile.json` и `rules.md` (ADR-0042 —
  Profile целиком на машине; пункт 1). Эти файлы написал перенос — код worfy, который убирает
  старый Harness из `~/.claude` (Ticket 14 Epic-а `worfy-harness`).
  - `rewriteHarnessPaths` (`src/main/harness/migrate/profiles.ts:46`) меняет начало пути:
    `~/.claude/hooks/` → `~/.claude/worfy-harness/plugin/hooks/` (шаблон — `:53`, ветка `hooks/` —
    `:59-60`). Имени файла после `hooks/` функция не знает.
  - Через неё идут `rules.md` (`src/main/harness/migrate/apply.ts:566`) и каждая строка
    `profile.json` (`rewriteValue`, `profiles.ts:76-83`; запись — `apply.ts:564`).
  - Test это закрепляет. `test/contract/harness-migrate.test.ts:296`: в перенесённом `rules.md`
    стоит `~/.claude/worfy-harness/plugin/hooks/gate.sh`. `:298`: в перенесённом `profile.json`
    `commands.verify` равен `bash ~/.claude/worfy-harness/plugin/hooks/gate.sh full </dev/null`.
  - `commands.verify` — полная локальная проверка Project-а одной строкой
    (`harness/profiles/README.md:132`). Агенты исполняют её как написано: Gate строки `commands.*`
    не исполняет (Ticket 03, «Что происходит», первый пункт).
  - ADR-0055 перечисляет ссылки, которые меняются со сменой имени Gate («Последствия», четвёртый
    пункт): `CONTEXT.md`, skills, `hooks/rules/common.md`. Profile-ов на машине в этом списке нет.
- **Как имя записано в fixture переноса** — образце старого `~/.claude` для test-ов
  (`test/fixtures/claude-home-legacy/home/.claude/profiles/`):
  - команда с `bash`: `atakama/profile.json:7` — `bash ~/.claude/hooks/gate.sh full </dev/null`;
    `worfy/rules.md:3` — `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full`;
  - команда по пути, без `bash`: `auction/rules.md:5` — `$HOME/.claude/hooks/gate.sh fast`;
  - упоминание пути, не команда: `atakama/rules.md:3`.
- **Mac владельца, прочитано 2026-10-13, ничего не менялось.** Profile-ов три. У `atakama`
  `commands.verify` — ровно строка из `:298`. У `worfy` и `auction` — простые команды `pnpm …`.
  Все три `rules.md` называют `gate.sh` в тексте.
- **Установщик Harness** — код `src/main/harness/install.ts`; в панели worfy это кнопки «Install»
  и «Update Harness» (`src/renderer/shell/toolbar/HarnessStatus.tsx:72`, `:80`). Папку `projects/`
  он сегодня не читает и не пишет: worfy сам пишет только `<harnessHome>/plugin/` (шапка,
  `install.ts:21-24`). `<harnessHome>` — папка состояния Harness, `~/.claude/worfy-harness/`.
  Test: после установки в ней лежит только `plugin`
  (`test/contract/harness-install.test.ts:357-369`).
- **Windows.** Старый Harness на Windows не работал. Перенесённый Profile может быть только на Mac.
- **Решение владельца 2026-10-13 («пока пусть Б»).** `gate.sh` пока остаётся как shim — файл из
  двух строк со старым именем, который запускает `node gate.mjs` с теми же аргументами. Ticket 03
  выходит с shim-ом, с test-ом «shim и `gate.mjs` дают один exit code и одну строку вердикта» и с
  переписанной проверкой `git grep`. Это отступление от буквы ADR-0055 (пункт 4: bash только в
  test-ах). ADR не правится. В тексте Ticket-а 03 на main `376e4b10` этого решения ещё нет.
- **Этот Ticket — конечное состояние:** имени `gate.sh` нет ни в том, что пишет перенос, ни в
  Profile-ах на машине, ни в `harness/`. Он идёт после закрытия приёмки E3 (E3 — Epic
  `worfy-harness`, Harness как plugin `worfy`; приёмка — его Ticket 26): перенос и установщик —
  предмет этой приёмки.
- Номера строк сверены по main `376e4b10`, до мержа Ticket-а 03. Перед началом повторить
  `git grep -n 'gate\.sh' -- harness src test` на свежем main.

## Что делаем

Один PR. Правка Profile-ов и удаление shim-а выходят в одной версии Harness. Версия без shim-а и
без правки оставила бы `commands.verify` у `atakama` без файла.

### 1. Правило замены имени — один модуль

- Новый модуль в `src/main/harness/`, имя выбирает Ticket. Его зовут и перенос, и установщик.
- `<P>` ниже — папка plugin в одной из четырёх записей, которые даёт перенос (`profiles.ts:48`,
  `:55`): `~/.claude/worfy-harness/plugin`, `$HOME/.claude/worfy-harness/plugin`,
  `${HOME}/.claude/worfy-harness/plugin` и абсолютный путь `<harnessHome>/plugin`.
- Правило для текста:
  - (а) `bash <P>/hooks/gate.sh` → `node <P>/hooks/gate.mjs`. Так же — с `sh` и `zsh` вместо
    `bash`. Слово, пробелы и открывающая кавычка перед путём, если она есть, — одно совпадение:
    `bash "<P>/hooks/gate.sh"` → `node "<P>/hooks/gate.mjs"`. Иначе выйдет `bash … gate.mjs`, и
    bash станет исполнять JavaScript. Перед словом — начало строки, пробел, `;`, `&`, `|`, `(` или
    кавычка.
  - (б) остальные `<P>/hooks/gate.sh` → `<P>/hooks/gate.mjs`. Это упоминание пути и команда по
    пути без интерпретатора. (б) действует, только если в той же команде перед путём нет слова
    `bash`, `sh` или `zsh` — с путём (`/bin/bash`), с флагами (`bash -x`), после `env` или `exec`.
    Если слово есть, а (а) не совпало, строка не меняется и попадает в «не тронуто»: иначе вышло бы
    `bash -x <P>/hooks/gate.mjs`.
  - `gate.sh` — конец имени: `gate.sh.bak` и `gate.sh-old` не совпадения.
  - Больше правило ничего не меняет. Аргументы, `</dev/null` и переменные перед командой остаются.
- Команда по пути (б) работает на Mac, если `gate.mjs` в копии plugin исполняемый и начинается с
  `#!/usr/bin/env node` (ADR-0055, пункт 2: эта строка остаётся). У соседних `gate-resolve.mjs` и
  `guard.mjs` режим в git — `100755`. Что Ticket 03 сделал с `gate.mjs`, проверить на main. Нет
  права на исполнение или строки `#!` — этот Ticket их добавляет.

### 2. Перенос пишет новое имя

- `rewriteHarnessPaths` после замены начала пути применяет правило пункта 1. Так оно действует и
  на `rules.md`, и на каждую строку `profile.json`.
- Что получается на fixture:
  - `atakama`, `commands.verify` —
    `node ~/.claude/worfy-harness/plugin/hooks/gate.mjs full </dev/null`;
  - `worfy/rules.md` — `GATE_SCOPE=all node ~/.claude/worfy-harness/plugin/hooks/gate.mjs full`;
  - `auction/rules.md` — `$HOME/.claude/worfy-harness/plugin/hooks/gate.mjs fast`;
  - `atakama/rules.md` — `~/.claude/worfy-harness/plugin/hooks/gate.mjs`.
- Форма переноса показывает эти строки до записи: «было» и «станет» она берёт из тех же функций
  (`src/main/harness/migrate/plan.ts:465-466`).
- Записи hooks старого Harness в `settings.json` (`test/contract/harness-migrate.test.ts:59-60`)
  перенос удаляет, как раньше. Правило их не касается.

### 3. Установщик правит уже перенесённые Profile-ы

Это первый код установщика, который пишет в Profile пользователя. **Нужно слово владельца, без
него Ticket не начинается.** ADR-0040 (доставка Harness: копия в `~/.claude/worfy-harness/plugin/`),
пункт 7, разрешает установщику писать в `~/.claude/worfy-harness/` после согласия пользователя;
Profile-ы лежат в этой папке (пункт 5), но в пункте 7 не названы. Запись Profile-ов кодом worfy
названа только у переноса (ADR-0047, пункт 8). Сегодня установщик пишет только `plugin/`
(`install.ts:21-24`). Второй вопрос владельцу — делать ли commit, см. ниже.

- **Что читается.** `profile.json` и `rules.md` каждой папки `<harnessHome>/projects/<имя>/`.
  Чтение ничего не пишет. Файл правится, только если его путь внутри `<harnessHome>/projects/`
  (пути так проверяет перенос — `under`, `apply.ts:113-122`; функция не экспортируется, её
  выносят в общий модуль) и сам файл не symlink.
- **`profile.json`: только поле `commands.verify`, только точное совпадение всего значения.**
  Значение равно `bash <P>/hooks/gate.sh <режим> </dev/null`, где `<режим>` — `fast` или
  `full`. Новое значение — `node <P>/hooks/gate.mjs <режим> </dev/null`. Любое другое значение
  с `gate.sh` — в `commands.verify` или в другом поле — не меняется и попадает в список
  «не тронуто».
- **`rules.md`: правило пункта 1,** по каждому совпадению. Строка с `gate.sh`, которую правило не
  заменило (другой путь, одно слово `gate.sh`), не меняется и попадает в «не тронуто» с номером
  строки.
- **В файле меняются только эти байты.** Правка — замена подстроки в тексте файла. `profile.json`
  не пишется заново через `JSON.stringify`: отступы, порядок ключей и конец файла остаются. Если
  значение в тексте файла записано иначе (например, `\/` вместо `/`) и подстрока не нашлась ровно
  один раз, файл не меняется и попадает в «не тронуто». Запись — через временный файл и rename,
  права файла сохраняются (как `writeAtomically`, `apply.ts:96-102`).
- **Перед записью файл читается заново.** Между планом и записью идут диалог, копия plugin и
  команды `claude plugin` (`install.ts:309`, `:322-323`). Если байты файла уже не те, по которым
  построен план, файл не меняется: состояние — `error` с новым шагом и причиной «файл изменился
  после диалога»; Retry строит план и диалог заново. Перенос проверяет так же (`apply.ts:352`,
  `:506`, `:546`).
- **Сначала список, потом запись.** План установки (`InstallPlan`, `install.ts:81-98`) получает
  правки: файл, номер строки, «было», «станет» — и список «не тронуто». Диалог согласия
  (`confirmationText`, `install.ts:207`) показывает оба списка. О списке «не тронуто» он говорит:
  после обновления эти строки перестанут работать, файла `gate.sh` в копии не будет. Фраза
  «Nothing else in ~/.claude changes» (`:225`, `:234`) при правках неверна и заменяется. Плану, в
  котором одни правки Profile-ов (версия уже стоит), нужна своя ветка текста диалога
  (`install.ts:226-235`). Отказ в диалоге не пишет ничего.
- **Резервная копия до записи.** Каждый файл перед правкой копируется в новую папку
  `<harnessHome>/backup-<дата>/` под тем же относительным путём. Имя папки — по правилу переноса
  (`apply.ts:261-262`; ADR-0047 — перенос и его резервная копия, пункт 6). Диалог называет папку.
- **Порядок.** Правка — последний шаг, после копии plugin и команд `claude plugin`
  (`install.ts:322-323`): к этому моменту `gate.mjs` в копии есть. Ошибка правки — состояние
  `error` с новым шагом в `harnessStepSchema` (`src/shared/ipc/harness.ts:16`).
- **Правку можно повторить.** Сейчас при той же версии план пуст и диалога нет (`install.ts:505`,
  `:308`). С неисполненными правками план не пуст. Состояние (`status()`, `install.ts:268`), когда
  копия и plugin уже этой версии, а правки остались, — `error` с тем же шагом: кнопка «Retry»
  (`HarnessStatus.tsx:86`) есть и после перезапуска worfy. Строки из «не тронуто» состояние не
  меняют: установщик их не правит. Это третий исход рядом с двумя из ADR-0059, пункт 5 («стоит
  или не стоит»); прецедент там же: `worfy` стоит, а зависимости нет — ошибка шага с планом из
  одних команд зависимости, Retry её ставит.
- **Commit в git папки состояния установщик не делает — вопрос владельцу.** Перенос коммитит
  Profile-ы в git `<harnessHome>` (`apply.ts:590-611`), здесь предлагается иначе: правка остаётся в
  рабочем дереве, потому что commit файла включил бы и незакоммиченные правки пользователя в нём.
  Пользователь видит правку в `git diff`, если папка состояния — git-репозиторий. Решение — в
  «Итог».
- **Повторный запуск ничего не меняет:** после правки совпадений нет, плана и диалога нет.

### 4. Shim и его test удаляются

- `harness/hooks/gate.sh` (shim Ticket-а 03) и test «shim и `gate.mjs` дают один exit code и одну
  строку вердикта» удаляются. Имя test-файла — по PR Ticket-а 03.
- Test-ы, которым нужен файл `gate.sh` в `harness/` (сверить после мержа Ticket-а 03):
  - `test/contract/harness-migrate.test.ts:314` запускает Gate из `harness/` командой
    `bash … hooks/gate.sh fast` — переходит на `node … hooks/gate.mjs fast`;
  - `test/unit/gate-state.test.ts:582` запускает `bash harness/hooks/gate.sh fast` — переходит на
    `node … gate.mjs fast`, если этого не сделал Ticket 03 (он называет только `:94-97`);
  - списки файлов копии Harness — `test/contract/harness-plugin.test.ts:68` и
    `test/e2e/packaged.spec.ts:189`: строка `hooks/gate.sh` меняется на `hooks/gate.mjs`, а не
    уходит. `true` в `packaged.spec.ts:189` — право на исполнение: это единственная автоматическая
    проверка того, что `gate.mjs` в сборке исполняемый.
- Распознавание старого имени в `src/main/gate/state.ts` остаётся (Ticket 03, «Что делаем»,
  пункт 9): старые транскрипты его содержат.

## Готово, когда

- [ ] До начала: Ticket 03 влит; в Ticket-е 26 Epic-а `worfy-harness` отмечены пункт 5 (прогон под
  вторым пользователем macOS) и версия `0.3.0`, его `Status` — `done`; владелец разрешил
  установщику править файлы в `projects/` и решил про commit (дата и слова — в «Итог»).
- [ ] `pnpm test test/contract/harness-migrate.test.ts` — exit code 0. В перенесённых Profile-ах
  fixture нет строки `gate.sh`. `commands.verify` у `atakama` равен
  `node ~/.claude/worfy-harness/plugin/hooks/gate.mjs full </dev/null`.
- [ ] Тот же test-файл: эта строка `commands.verify`, запущенная через `bash -c` в песочнице, где
  копия `harness/` лежит в `worfy-harness/plugin/`, печатает строку `[gate] …`; exit code — не 127.
- [ ] `pnpm test test/contract/harness-install.test.ts` — exit code 0. В нём случаи раздела
  «Тесты»: правка после согласия, отказ, команда, изменённая руками, повторный запуск, песочница
  без `projects/`.
- [ ] Unit-test правила замены: `pnpm test test/unit/<имя>.test.ts` — exit code 0. На каждом из
  трёх мутантов раздела «Тесты» падает свой test.
- [ ] `harness/hooks/gate.sh` и test shim-а удалены. `git ls-files -s harness/hooks/gate.mjs`
  печатает режим `100755`; `head -1 harness/hooks/gate.mjs` — `#!/usr/bin/env node`.
- [ ] Mac владельца; проверки только читают; команды и вывод — в «Итог». До обновления снять
  `shasum -a 256` шести файлов трёх Profile-ов. После `pnpm install:stable` и «Update Harness»:
  диалог назвал файлы, строки и папку резервной копии; `commands.verify` у `atakama` — новая
  строка; суммы `profile.json` у `worfy` и `auction` прежние; `diff` каждого из трёх `rules.md` с
  его копией из `backup-<дата>/` показывает только строки с путём Gate;
  `grep -n 'gate\.sh'` по шести файлам находит только строки из «не тронуто» или ничего.
- [ ] `gate full` зелёный на Mac; ручной job «Windows tests» на test-файлах PR — без новых падений
  против main; CI на PR зелёный.
- [ ] `git grep -n 'gate\.sh' -- harness` ничего не находит: эту проверку Ticket 03 с shim-ом
  выполнить не мог. `git grep -l 'gate\.sh' -- src` печатает ровно два файла:
  `src/main/gate/state.ts` (распознавание старых вызовов Gate в транскриптах; Ticket 03, «Что
  делаем», пункт 9) и модуль замены из пункта 1 — он называет имя, которое заменяет.

## Тесты

Сначала падающие test-ы; в «Итог» — как они падали:

- `test/contract/harness-migrate.test.ts`: ожидания `:296` и `:298` переписаны на `gate.mjs` и
  `node …`; добавлено: ни один `profile.json` и `rules.md` перенесённых Profile-ов не содержит
  `gate.sh`. На main красный: перенос пишет `gate.sh`.
- `test/contract/harness-install.test.ts`: в песочнице лежит
  `<harnessHome>/projects/atakama/profile.json` со строкой из `:298`; после `install()` с согласием
  значение новое. На main красный: установщик `projects/` не читает.

Остальное:

- **Unit-test правила замены.** Четыре записи `<P>`; `bash`, `sh`, `zsh`; путь в кавычках после
  `bash`; команда по пути; путь в скобках; `GATE_SCOPE=all bash …`. Не совпадения: `gate.sh.bak`,
  `${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh`, старый `~/.claude/hooks/gate.sh`, одно слово `gate.sh`. Ни
  в одном результате перед `gate.mjs` нет `bash`, `sh` или `zsh`. Ожидание test-а
  `rewriteHarnessPaths` (`test/contract/harness-migrate.test.ts:181-190`) — `gate.mjs`.
- **Установщик, в песочнице** (`test/contract/harness-install.test.ts`).
  - После правки `profile.json` отличается от прежнего только заменённой подстрокой. Случай: файл с
    отступами табуляцией и без перевода строки в конце.
  - Команда, изменённая руками (`GATE_SCOPE=all bash <P>/hooks/gate.sh full </dev/null`;
    `bash <P>/hooks/gate.sh full && pnpm e2e`): файл байт в байт прежний, строка — в «не тронуто» и
    в тексте диалога.
  - `profile.json` без `commands`, с испорченным JSON, файл-symlink: не изменены, установка идёт до
    конца.
  - Отказ в диалоге: файлы песочницы и их время прежние (как `:421-431`).
  - Повторный запуск: плана и диалога нет (как `:371`).
  - В папке резервной копии — прежние байты каждого изменённого файла.
  - Песочница без `projects/`: test `:357-369` проходит без правок — в папке состояния только
    `plugin`.
  - Ошибка записи Profile: состояние `error` с новым шагом; копия plugin новой версии на месте;
    следующий `install()` доводит правку до конца.
- **Мутанты, по одному:** правило (а) без кавычки; `commands.verify` сравнивается как подстрока, а
  не целиком; `profile.json` пишется через `JSON.stringify`. На каждом мутанте падает свой test.
- **Изоляция.** Test-ы идут в песочнице: `HOME` и `CLAUDE_CONFIG_DIR` во временной папке (ADR-0040,
  пункт 7). Ни один test не читает и не пишет настоящий `~/.claude`.

## Где в коде

- `src/main/harness/` — новый модуль с правилом замены.
- `src/main/harness/migrate/profiles.ts` — `rewriteHarnessPaths` (`:46-73`), `rewriteValue`
  (`:76-83`).
- `src/main/harness/install.ts` — шапка (`:1-28`), `InstallPlan` (`:81-98`), `confirmationText`
  (`:207-257`), `status` (`:268`), `runInstall` (`:293-328`), `planOf` (`:477-519`).
- `src/shared/ipc/harness.ts:16` — `harnessStepSchema`.
- `harness/hooks/gate.sh` и test shim-а — удаляются; `harness/hooks/gate.mjs` — режим и строка `#!`.
- Test-ы: `test/contract/harness-migrate.test.ts`, `test/contract/harness-install.test.ts`,
  `test/contract/harness-plugin.test.ts:68`, `test/e2e/packaged.spec.ts:189`.
- `test/unit/harness-migration-form.test.tsx:61`, `:156` — строки-образцы формы переноса с
  `gate.sh`; привести к тому, что пишет перенос.
- `test/fixtures/claude-home-legacy/` не меняется: это старый Harness до переноса.

## Вне скоупа

- Сам Gate на Node (замена `gate.sh` на `gate.mjs`), shim и его test —
  [Ticket 03](03-gate-на-node.md).
- Остальные hooks на bash (`inject-rules`, `session-start`, `session-end`, `stop`; ADR-0055,
  пункт 1) и их имена — [Ticket 04](04-hooks-harness-на-node.md) (Hooks Harness на Node). Правило
  пункта 1 знает только `gate.sh`.
- Profile-ы на Windows: перенесённого Profile там нет, установщик там ничего не находит.
- Старый Harness в `~/.claude` на машине без переноса и его `~/.claude/hooks/gate.sh`: не меняются.
- Текст ADR-0055 не правится. С удалением shim-а отступление от его пункта 4 исчезает.

## Риски

- **Установщик впервые пишет в Profile пользователя.** Ошибка правила портит команду проверки
  Project-а. Меры — в пункте 3; test-ы идут только в песочнице.
- **Profile, где команду меняли руками.** Она не совпадает целиком, и установщик её не трогает.
  После обновления файла `gate.sh` в копии нет, и команда перестаёт работать. Диалог называет
  такую строку до обновления. Правит её пользователь: `bash` → `node`, `gate.sh` → `gate.mjs`.
- **Транскрипты и заметки, где записано `gate.sh`.** Это старые транскрипты Session-ов, memory и
  уроки Project-ов, Ticket-ы. Их никто не переписывает.
  - Что видит пользователь. Команда `bash ~/.claude/worfy-harness/plugin/hooks/gate.sh full`
    после удаления shim-а не находит файл. Ожидается ответ bash `No such file or directory` и
    exit code 127; строки `[gate] …` нет. Точный вывод проверить на Mac и записать в «Итог».
  - По правилам Harness это не «зелено» и не «красно» (`harness/hooks/rules/common.md:59-61`: 2 —
    красно, 3 — не проверено, 0 со строкой `[gate] зелено` — зелено). Агент сообщает «не
    проверено».
  - worfy такой вызов узнаёт: старое имя остаётся в `src/main/gate/state.ts:181`. Без строки
    `[gate] …` вердикт он не меняет (`:353-354`): бейдж Gate показывает прежний исход.
  - В контексте Session, начатой до обновления, уже стоит правило с путём `gate.sh`
    (`common.md:57`). Диалог установщика просит перезапустить такие Session-ы (`install.ts:240`).
- **Порядок с приёмкой E3.** Пункты 1–4 приёмки приняты на нынешнем коде переноса и установщика;
  открыты пункт 5, шаг владельца, и версия `0.3.0`. Правка этого кода до закрытия значит: принят
  один код, а в сборке другой. Поэтому Ticket ждёт закрытия, хотя Ticket-ы 03–07 его не ждут
  (решение владельца 2026-10-13; Ticket 03, «Что происходит»).
- **Номера строк сдвинутся.** Ticket 03 меняет `harness/` и test-ы до начала этого Ticket-а.

## Итог

Закрыт Session на Mac 2026-10-14, после merge PR #298 (Ticket 03, main `1c1beadd`). Кода нет.
Номера строк ниже — по main `1c1beadd`.

- **Решение владельца 2026-10-14** (дано в чате Session на Mac, подтверждено в чате Session на
  Windows-ПК): `gate.sh` — точка входа hook-ов `TaskCompleted` и `TeammateIdle`, файл запуска на
  bash. Он ищет node — `PATH`, затем `/opt/homebrew/bin`, `/usr/local/bin`, версия nvm — и
  запускает `gate.mjs` с теми же аргументами и stdin (`harness/hooks/gate.sh:29-40`). Без node
  отвечает сам, как bash-Gate до Ticket-а 03: строка «ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден», код 3,
  маркер `nokey-broken-…` и файл вердикта `unverified` (`:42-136`). `hooks.json` зовёт его по пути
  (`harness/hooks/hooks.json:67`, `:78`). Решение заменило решение 2026-10-13 («пока пусть Б»: файл
  из двух строк до этого Ticket-а).
- **Конечное состояние этого Ticket-а недостижимо:** имя `gate.sh` остаётся в `harness/`. Пункт 4
  (удалить файл и его test) отменён тем же решением.
- **Пункты 1–3 без пункта 4 ничего не дают.** Правило замены, перенос с `node … gate.mjs` и правка
  перенесённых Profile-ов установщиком были нужны, потому что без файла строка
  `bash ~/.claude/worfy-harness/plugin/hooks/gate.sh full </dev/null` в `commands.verify` у
  `atakama` перестала бы работать («Что делаем», первый абзац). Файл остаётся, строка работает.
  Замена её даже ухудшила бы: без node на `PATH` агента `bash …/gate.sh` отвечает кодом 3 и строкой
  «node не найден», а `node …/gate.mjs` падает с кодом 127 и ничего не пишет
  (`harness/hooks/gate.mjs:94-96`). А правка Profile-ов — первая запись кода worfy в Profile
  пользователя («Риски», первый пункт).
- **Что осталось — текст на main, который обещает этот Ticket:** шапка `harness/hooks/gate.sh:25-26`
  и `harness/README.md:19` говорят, что Ticket 46 уберёт старое имя из Profile-ов;
  `harness/profiles/README.md:132` называет `bash <plugin>/hooks/gate.sh` старым написанием. Это
  правка текста в файлах PR #298 — пункт [Ticket-а 48](48-остатки-ревью-pr-298.md).
- **ADR-0055 не правится.** Отступление от его пунктов 2 и 4 (команда hook-а — явный `node`; bash
  только в test-ах) записано в шапках `gate.sh` и `gate.mjs` и в «Итоге» Ticket-а 03.
