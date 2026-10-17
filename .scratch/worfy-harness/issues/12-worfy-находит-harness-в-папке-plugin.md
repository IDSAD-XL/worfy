# 12 — worfy находит Harness в папке plugin, передаёт свой Harness Session-ам и шлёт команды по установленному Harness

Type: task
Status: done 2026-10-07
PR: #117
Blocked by: 04, 10
Source: решения владельца 2026-10-07: Q1 (копия `harness/` в `~/.claude/worfy-harness/plugin/` как локальный marketplace; Session-ы worfy получают plugin своей версии inline), Q2 (имя plugin-а `worfy`, команды `/worfy:epic-wave`, `/worfy:ship-ticket`), Q4 (состояние Harness — `~/.claude/worfy-harness/`), Q6 (формат команды Autopilot — английская машинная строка), Q13 и Q33 (машина владельца переходит на plugin в Ticket-е 16, до того Wave-ы идут на старом Harness); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (доставка Harness, состояние машины); [ADR-0047](../../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md) (развитие Harness, ранний переход машины владельца); [spec.md](../spec.md)

## Что происходит

- worfy зовёт скрипты Harness из `<claudeHome>/bin/`: `epic-status --json` (`src/main/workflow/reader.ts:63-67`)
  и `profile -C … --field …` (`src/main/workflow/profile.ts:41`, `:51-52`). `claudeHome()` —
  `~/.claude` или `WORFY_CLAUDE_HOME` (`src/main/storage/paths.ts:36-43`).
- Реестр Gate и маркеры worfy читает из `<claudeHome>/gate/config.json` и `<claudeHome>/gate/state/`
  (`src/main/gate/state.ts:42-49`, `:87-93`), транскрипты — из `<claudeHome>/projects/` (`:365`);
  всё — от одного `home` (`GateReaderOptions`, `:342-345`).
- После Ticket-ов 13, 14 и 16 (установщик, перенос файлов, переход машины владельца) Harness живёт
  так (Q1, Q4): plugin — `~/.claude/worfy-harness/plugin/` (скрипты в `bin/`, манифест
  `.claude-plugin/plugin.json` с `name: worfy` — из Ticket-а 02), состояние —
  `~/.claude/worfy-harness/` (реестр `gate/config.json`, `gate/state/`, Profile-ы). В `~/.claude/bin/`
  Harness-а нет. До Ticket-а 16 машина владельца — на старом Harness в `~/.claude`, и Stable copy
  (сборка worfy, из которой Autopilot ведёт Wave-ы) работает на нём.
- Session-ы worfy plugin-ы не передают (`src/main/agent/options.ts:92-128`). Plugin, переданный
  inline (`plugins: [{ type: 'local', path }]`), молча заменяет установленный plugin с тем же
  именем (факт spike 2026-10-07).
- `electron-builder.yml:9-11` кладёт в `.app` только `out/**` и `package.json`: `harness/` в `.app`
  нет.
- Шаблоны действий «Ship ticket» и «Run wave» (`src/shared/projects/action-templates.ts:32-38`) —
  `/ship-ticket {epic} {NN}` и `/epic-wave Ticket-ы {tickets} эпика {epic}`. Skill plugin-а голым
  именем не вызывается, только `/worfy:epic-wave` (факт spike). Шаблоны пишутся в настройки
  Project-а один раз, при добавлении (`src/main/projects/settings.ts:28-34`); при чтении старый
  шаблон «Run wave» по умолчанию заменяется нынешним (`:12-20`, ADR-0033 — Autopilot называет
  Ticket-ы Wave). Кнопка «Reset to default» берёт константу (`src/renderer/shell/ProjectSettings.tsx:192`).
- Ticket 10 (имена с префиксом `worfy:`) учит worfy разбирать такие команды в транскриптах; что
  worfy шлёт сам — этот Ticket.

## Что делаем

1. **Какой Harness на машине** — новый модуль `src/main/harness/locate.ts` (Q1, Q4):
   - `plugin` — есть `<harnessHome>/plugin/.claude-plugin/plugin.json` с `"name": "worfy"` и
     `<harnessHome>/plugin/bin/epic-status`. Скрипты — `<harnessHome>/plugin/bin/`, состояние
     Gate — `<harnessHome>/gate/`.
   - `legacy` — есть `<claudeHome>/bin/epic-status`. Скрипты — `<claudeHome>/bin/`, состояние
     Gate — `<claudeHome>/gate/`, как сейчас.
   - Есть оба — `legacy`. Пока hooks старого Harness записаны в `~/.claude/settings.json`, plugin с
     теми же hooks запускал бы их второй раз; старые файлы убирает перенос (Ticket 14), и тогда
     остаётся `plugin`. Так Stable copy на машине владельца до Ticket-а 16 работает как сейчас
     (Q13, Q33).
   - Нет ни одного — `none`: чтение workflow отвечает, как сейчас без скрипта (`not-found`), в
     причине — оба проверенных пути.

   `harnessHome()` в `src/main/storage/paths.ts` — `WORFY_HARNESS_HOME` или
   `<claudeHome()>/worfy-harness`: test-ы и e2e с временным `WORFY_CLAUDE_HOME` не видят настоящий
   `~/.claude/worfy-harness/`. Переход машины на plugin worfy видит без перезапуска.
2. **Скрипты и состояние — от найденного Harness.** `epicStatusPath` и `profilePath` берут папку
   `bin/` из пункта 1; call site-ы с `claudeHome()` не меняются. При `plugin` скрипты получают в
   окружении `HARNESS_HOME=<harnessHome()>` (переменная Ticket-а 08 — перевод и пути `bin/`).
   `GateReader` читает реестр и маркеры из папки состояния Gate найденного Harness, транскрипты —
   по-прежнему из `<claudeHome>/projects/`. Новое поле `GateReaderOptions` — со значением по
   умолчанию, чтобы `new GateReader({ home })` в test-ах осталось как есть.
3. **Свой Harness inline** (Q1). При `plugin` и `none` Session-ы worfy стартуют с
   `plugins: [{ type: 'local', path: <свой harness> }]`, при `legacy` — без `plugins`.
   - `<свой harness>` — путь из `src/main/harness/bundled.ts` Ticket-а 04: в собранном `.app` —
     `<resourcesPath>/harness`, без упаковки (dev, e2e) — `out/harness/`, копия с `version` в
     `plugin.json` и без test-ов. Исходный `harness/` рабочего дерева inline не передаётся.
   - Путь считается при каждом старте Session, поэтому переезд `.app` его не ломает. Отвергнутый
     вариант В решения Q1 (грузить из `.app`) был про установку в область пользователя, не про
     inline.
   - `harness/` в `.app` кладёт сборка Ticket-а 04 (версия в `plugin.json`). Если после Ticket-а 04
     его там нет — исполнитель добавляет `extraResources` в `electron-builder.yml` и вносит файл в
     «Где в коде».
4. **Шаблоны действий — по найденному Harness** (Q2, Q6).
   - По умолчанию при `legacy` — нынешние шаблоны; при `plugin` и `none` —
     `/worfy:ship-ticket {epic} {NN}` и `/worfy:epic-wave …`: текст после имени — формат команды
     Autopilot, который объявляет `harness/skills/epic-wave/SKILL.md` после Ticket-а 06 (перевод
     skills epic-wave и ship-ticket). Шаблон «Run wave» содержит `{tickets}`: без него Autopilot не
     стартует (ADR-0033).
   - При чтении настроек Project-а шаблон, равный любому прежнему шаблону по умолчанию
     (`/ship-ticket {epic} {NN}`, `/epic-wave Ticket-ы {tickets} эпика {epic}`,
     `/epic-wave волна {wave} эпика {epic}`, шаблоны `plugin`), читается как шаблон по умолчанию
     найденного Harness. Свой шаблон владельца остаётся как есть. Файл настроек при чтении не
     переписывается (как сейчас).
   - Новый Project получает шаблоны найденного Harness. «Reset to default» ставит шаблоны
     найденного Harness — их отдаёт main; форму IPC выбирает исполнитель.
   - Ticket 06 по плану Epic-а не в Blocked by. Если к началу работы он не влит и формата команды
     нет — `ticket block` с этой причиной.
5. **worfy ничего не пишет** в `~/.claude`, `~/.claude/worfy-harness/` и в папку своего
   `harness/` (ADR-0005 — worfy пишет только в свою папку данных). Установка plugin-а и перенос —
   Ticket-ы 13 и 14.

Нужен один новый ADR — на отступление от ADR-0040, пункт 2 (Session-ы worfy всегда получают свой
plugin inline). На время перехода, при `legacy` и когда на машине есть оба Harness, Session-ы worfy
идут без `plugins` (пункты 1 и 3). Причина — двойные hooks: пока записи старого Harness стоят в
`~/.claude/settings.json`, hooks plugin-а запускались бы второй раз (ADR-0041; spec.md, раздел
«Риски и открытые технические вопросы», пункт 3). Отступление кончается, когда перенос (Ticket 14)
на шаге владельца (Ticket 16) убирает старые файлы. Номер ADR выдаёт Orchestrator при взятии
Ticket-а (сейчас следующий свободный — 0049; spec.md, «Соглашения для Ticket-ов этого Epic-а»). Где
лежат plugin и состояние и что в остальных случаях Session-ы worfy получают plugin inline, решено в
ADR-0040; этот Ticket его выполняет.

**Не входит:** установка и обновление plugin-а — Ticket 13; версия в UI — Ticket 04; пометка
«Harness в main новее, чем в Stable copy» — Ticket 21; файл вердикта Gate — Ticket 09 (worfy
читает его из той же папки состояния Gate, что и маркеры); разбор `/worfy:` в транскриптах —
Ticket 10.

## Готово, когда

- [x] Unit (`test/unit/harness-locate.test.ts`, на временных папках): только plugin — `plugin` с путями `bin/` и `gate/` от `harnessHome`; только `<claudeHome>/bin/epic-status` — `legacy`; оба — `legacy`; ничего — `none`; `plugin.json` с другим `name` или plugin без `bin/epic-status` — не `plugin`.
- [x] Unit (`test/unit/paths.test.ts`): `harnessHome()` — `WORFY_HARNESS_HOME`, а без него — `<claudeHome()>/worfy-harness`.
- [x] Contract (`test/contract/workflow-reader.test.ts`): stub `epic-status` в `<harnessHome>/plugin/bin/` читается при `plugin` и получает `HARNESS_HOME`; прежние случаи со stub-ом в `<claudeHome>/bin/` проходят без правок; при `none` ошибка `not-found` называет оба пути.
- [x] Contract (`test/contract/workflow-profile.test.ts`): `profile` из `<harnessHome>/plugin/bin/` с `HARNESS_HOME` в окружении; прежние случаи — без правок.
- [x] Unit (`test/unit/gate-state.test.ts`): при `plugin` маркер в `<harnessHome>/gate/state/` и реестр `<harnessHome>/gate/config.json` дают вердикт, транскрипты читаются из `<claudeHome>/projects/`; при `legacy` — как сейчас.
- [x] Unit (`test/unit/agent-options.test.ts`): с путём своего Harness — `plugins: [{ type: 'local', path }]`; без него поля `plugins` нет. Путь своего Harness берётся из `bundled.ts` Ticket-а 04 (test подменяет его), а не из `<appPath>/harness`.
- [x] Unit (`test/unit/action-templates.test.ts`): шаблоны по умолчанию для `legacy` и для `plugin`; каждый прежний шаблон по умолчанию читается как шаблон найденного Harness; свой шаблон (`my ship {NN}`, пустой) не меняется; шаблон «Run wave» при `plugin` содержит `{tickets}`.
- [x] Ничего не пишется: test сравнивает списки файлов `<claudeHome>` и `<harnessHome>` до и после чтения workflow, Profile и Gate (по образцу «writes nothing», `test/unit/gate-state.test.ts:338`).
- [x] `@packaged` (`test/e2e/packaged.spec.ts`): в собранном `.app` есть `Contents/Resources/harness/.claude-plugin/plugin.json` с `"name": "worfy"`.
- [x] Новый ADR об отступлении от ADR-0040, пункт 2: вторая строка «Дата: … Статус: принят.», раздел `## Considered Options`; ADR говорит, что уточняет ADR-0040, и называет условие, при котором отступление кончается.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; CI на PR зелёный. `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` на ветке после rebase — код 0 и строка `[gate] зелено` (e2e и `@packaged` идут здесь).
- [ ] (вручную) Stable copy после влития, машина владельца до Ticket-а 16: Canvas Project-а worfy показывает Epic-и и бейджи Gate, как до Ticket-а (найден `legacy`); «Run wave» шлёт прежний текст. Как проверить: окно приложения. — Не проверено: окно Stable copy агент не открывал; пункт в HANDOFF, «Ждёт владельца».

Ручной пункт агент проверяет, только если может посмотреть окно Stable copy. Если не может —
«не проверено: …» в «Итог» и пункт в HANDOFF, раздел «Ждёт владельца».

## Тесты

Сначала падающий test — `test/unit/harness-locate.test.ts`: при одной папке
`<harnessHome>/plugin/` найден `plugin`. Модуля нет — test красный. Второй — contract в
`test/contract/workflow-reader.test.ts`: stub `epic-status` только в `<harnessHome>/plugin/bin/` —
на нынешнем main ошибка `not-found`. В «Итог» — как они падали.

- `test/unit/harness-locate.test.ts` — новый: четыре случая пункта 1 и битый манифест.
- `test/unit/paths.test.ts` — `harnessHome()`.
- `test/contract/workflow-reader.test.ts`, `test/contract/workflow-profile.test.ts` — скрипты из
  plugin-а, `HARNESS_HOME` в окружении.
- `test/unit/gate-state.test.ts` — папка состояния Gate при `plugin`.
- `test/unit/agent-options.test.ts` — `plugins` и путь своего Harness.
- `test/unit/action-templates.test.ts` — шаблоны по Harness и чтение прежних.
- `test/e2e/packaged.spec.ts` — `harness/` в `.app` (`@packaged`, только в `gate full`).

## Где в коде

- `src/main/harness/locate.ts` — новый: какой Harness на машине, где его скрипты и состояние Gate
- `src/main/storage/paths.ts`
- `src/main/workflow/reader.ts`
- `src/main/workflow/profile.ts`
- `src/main/gate/state.ts`
- `src/main/agent/options.ts`
- `src/main/agent/app-registry.ts`
- `src/shared/projects/action-templates.ts`
- `src/main/projects/settings.ts`
- `src/shared/ipc/projects.ts`
- `src/main/ipc/projects.ts`
- `src/renderer/shell/ProjectSettings.tsx`
- `test/unit/harness-locate.test.ts` — новый
- `test/unit/paths.test.ts`
- `test/unit/gate-state.test.ts`
- `test/unit/agent-options.test.ts`
- `test/unit/action-templates.test.ts`
- `test/contract/workflow-reader.test.ts`
- `test/contract/workflow-profile.test.ts`
- `test/e2e/packaged.spec.ts`
- `docs/adr/0049-worfy-sessions-without-inline-plugin-on-legacy-harness.md` — новый
- `test/contract/projects.test.ts` — добавлен при работе: test читал шаблоны по умолчанию от настоящего `~/.claude`
- `test/unit/agent-query-factory.test.ts` — добавлен при работе: `plugins` от `sdkQueryFactory`
- `test/e2e/projects.spec.ts` — добавлен при работе: пустой Claude home `launchApp` теперь `none`, снимки диалога

Только чтение: `src/main/harness/bundled.ts` (Ticket 04) — путь и версия копии Harness этой сборки.
Новый файл ADR (`docs/adr/<номер>-….md`, «Что делаем», после пункта 5) добавляется сюда, когда
Orchestrator выдаст номер; общих файлов он не даёт.

Call site-ы `claudeHome()` (`src/main/ipc/workflow.ts`, `src/main/ipc/actions.ts`,
`src/main/ipc/autopilot.ts`, `src/main/ipc/checks.ts`, `src/main/mcp/canvas-server.ts`) не
меняются. Общие файлы с Ticket-ом 09 (вердикт Gate JSON-файлом) — `src/main/gate/state.ts` и
`test/unit/gate-state.test.ts`: в одну Wave они не попадут, второй делает rebase. С Ticket-ом 13
(установщик) общий helper — `harnessHome()` в `src/main/storage/paths.ts`; Ticket 13 ждёт этот
Ticket (Blocked by) и берёт helper отсюда.

## Итог

- `src/main/harness/locate.ts` — какой Harness на машине: `plugin`, `legacy`, `none`, по правилам пункта 1;
  при обоих — `legacy`. Ищет при каждом вызове, ничего не кэширует и не пишет. `harnessHome()` в
  `src/main/storage/paths.ts` — `WORFY_HARNESS_HOME` или `<claudeHome>/worfy-harness`.
- `epic-status` и `profile` берутся из `bin/` найденного Harness; скрипты plugin-а получают `HARNESS_HOME`.
  Если Harness сменился посреди прогона `epic-status` (перенос Ticket-а 14 убрал старые скрипты), reader
  запускает его ещё раз с найденным заново — иначе ошибка висела бы на Canvas до следующего изменения в
  Project-е (гонка замечена на e2e-снимке, test — «runs once more with the plugin…» в `workflow-reader.test.ts`).
- `GateReader` читает реестр, маркеры и файл вердикта из `gate/` найденного Harness, транскрипты — из
  `<claudeHome>/projects/`. Новое поле `GateReaderOptions.harnessHome` необязательное.
- Session-ы worfy при `plugin` и `none` получают `plugins: [{ type: 'local', path: bundledHarnessDir() }]`,
  при `legacy` — без `plugins` (ADR-0049). `harness/` в `.app` уже кладёт сборка Ticket-а 04; `@packaged`
  проверяет `name: worfy` в `Contents/Resources/harness/.claude-plugin/plugin.json`.
- Шаблоны по умолчанию: при `legacy` — прежние, при `plugin` и `none` — `/worfy:ship-ticket {epic} {NN}` и
  `/worfy:epic-wave tickets {tickets} of epic {epic}` (формат Autopilot из `harness/skills/epic-wave/SKILL.md`).
  Любой прежний шаблон по умолчанию читается как шаблон найденного Harness, файл не переписывается.
  «Reset to default» берёт шаблоны у main по новому каналу `projects.settings.defaults`.
- Падающие test-ы первыми: `test/unit/harness-locate.test.ts` — «Failed to resolve import
  ../../src/main/harness/locate» (модуля нет); contract в `workflow-reader.test.ts` со stub-ом только в
  `<harnessHome>/plugin/bin/` — `expected { code: 'not-found', … } to be null`.
- Снимки диалога «Project settings» в обеих темах (`test/e2e/projects.spec.ts`, «follow the Harness»):
  старый Harness — [светлая](../evidence/12-project-settings-legacy-light.png),
  [тёмная](../evidence/12-project-settings-legacy-dark.png); plugin после «Reset to default» —
  [светлая](../evidence/12-project-settings-plugin-light.png), [тёмная](../evidence/12-project-settings-plugin-dark.png).
- Решено без владельца, подтверждено владельцем 2026-10-12:
  - `none` (Harness не найден) читает скрипты и Gate из `<claudeHome>/bin` и `<claudeHome>/gate`, как до
    Ticket-а: так прежние test-ы и машины без Harness ведут себя по-старому;
  - `legacy` узнаётся по наличию файла `<claudeHome>/bin/epic-status`, без проверки права на запуск: любой
    след старого Harness — без inline plugin-а, чтобы hooks не сработали дважды;
  - при `none` про оба пути говорит только ошибка `epic-status`; причина «нет скрипта profile» называет
    `<claudeHome>/bin/profile`, как раньше (прежние случаи `workflow-profile.test.ts` — без правок);
  - `DEFAULT_ACTION_TEMPLATES` остался именем шаблонов старого Harness: на нём стоят test-ы и фикстуры с
    `bin/epic-status`; код приложения берёт `defaultActionTemplates(kind)`;
  - канал `projects.settings.defaults` без аргументов, ответ — настройки Project-а целиком.
- Не проверено: ручной пункт про Stable copy на машине владельца. Окно Stable copy агент не открывал:
  запуск настоящего worfy поднимает Orchestrator на настоящем Claude Code и пишет в `~/.claude`, это запрещено.
  Вместо него — test-ы на `legacy` (старый Harness, с plugin-ом рядом и без): прежние шаблоны, скрипты из
  `<claudeHome>/bin`, Gate из `<claudeHome>/gate`, Session без `plugins`. Пункт идёт в HANDOFF, «Ждёт владельца» (HANDOFF правит Orchestrator).

**Влито.** [PR #117](https://github.com/IDSAD-XL/worfy/pull/117) → squash-коммит `7652f5d` в `main`. Ревью —
VERIFIED с первого круга. Новый ADR — [ADR-0049](../../../docs/adr/0049-worfy-sessions-without-inline-plugin-on-legacy-harness.md)
(Session-ы worfy без inline plugin-а, пока на машине старый Harness). Ревьюер сверил `legacy` (один и с
plugin-ом рядом) с базой `6580d95`: шаблоны, `epic-status` и `profile`, папка Gate и Session-ы без `plugins`
те же; четыре мутанта красные; в Claude home и Harness home ничего не пишется. Перед мержем: rebase на
`6580d95`, head `4ee394d`, `GATE_SCOPE=all gate full` — exit 0 и `[gate] зелено (full)`, CI зелёный,
`mergeStateStatus` CLEAN.

**Долг.**
- [low] `src/main/harness/locate.ts:75` — при `none` (Harness не найден) Session получает inline plugin, а
  worfy читает Gate из `<claudeHome>/gate`. `gate.sh` plugin-а пишет в
  `${HARNESS_HOME:-~/.claude/worfy-harness}/gate/state`, поэтому эти вердикты Gate worfy не видит. Решено
  без владельца; подтверждено владельцем 2026-10-12.
- [low] `docs/adr/0049-…md:44` — слова «`bin/epic-status` в первую очередь» можно прочесть как «удалить его первым».
  Ticket 14 (перенос Harness из `~/.claude`) должен удалять `bin/epic-status` последним, после записей
  hooks в `~/.claude/settings.json`. Иначе Session-ы в этот промежуток получат inline plugin, и hooks
  сработают дважды.
- [low] `src/renderer/shell/ProjectSettings.tsx:113` — ответ «Reset to default» может затереть текст,
  набранный, пока запрос IPC в пути.
- [low] `test/unit/agent-query-factory.test.ts` — прежние случаи ищут Harness в настоящем `~/.claude`:
  результат зависит от машины.
- Решения без владельца (пункты «Решено без владельца, подтвердить» выше) — в HANDOFF, «Ждёт владельца».
