# 78 — «Edit profile»: все поля Profile-а после подключения Project-а

Type: task
Status: claimed 2026-11-09T22:36Z
Blocked by: —
Source: просьба владельца 2026-11-09: после подключения Project-а поменять его Profile можно только руками в
`profile.json`. Строки перечитаны по main `964061f9a`.

## Что происходит

Поправка брифа: `src/main/projects/settings.ts` Profile не пишет. Он пишет собственный файл worfy
`<папка данных Project-а>/settings.json` (`writeProjectSettings`, :44): шаблоны действий, shell Terminal-а на Windows,
`defaultVendor`, `humanReview`; экран — `src/renderer/shell/ProjectSettings.tsx` (`projects.settings.set`, :171).

Сам `profile.json` после подключения меняют три поля, и все — через `harness/bin/profile-set` (ADR-0073: Profile
пишет только скрипт Harness-а, с `--expect <fingerprint>` и commit-ом в git Harness-а):

- `workflow.pipeline` — Settings → Pipeline (`src/renderer/settings/PipelineSection.tsx:300`, `pipeline.write` →
  `src/main/ipc/pipeline.ts:55`);
- `workflow.agents` и `agents` — Settings → Plan (`src/renderer/settings/PlanSection.tsx:98`, `planPreset.apply` →
  `src/main/ipc/plan-preset.ts:81`) и Eco в меню Modes (`src/renderer/session/modes/eco-mode.ts:93` →
  `src/main/ipc/eco-mode.ts:27`).

Остальное задаётся один раз, на шаге Review диалога Add project (`case 'form'`,
`src/renderer/projects/ConnectProject.tsx:605`): name :671, commands :688, Gate roots, ticket branch :728, finish :729,
review lenses :730, MCP servers :731, GitHub account :667, rules.md :743. `mode` там только показан (:675), выбирается
на шаге Mode. Полей `tickets.path`, `tickets.spec`, `tickets.trail_section`, `skills.allowed` на шаге Review нет вовсе.
После подключения всё это меняется только руками в `~/.claude/worfy-harness/projects/<name>/profile.json`, без
проверки схемой.

Схема есть: `harness/profiles/draft.schema.json` (верх — `profile`, `rules`, `gate`; `profile.properties` — agents,
attribution, commands, deploy, docs, github, language, layout, lessons, mcp, mode, name, numbering, parallel, review,
schema, skills, stack, tickets, title, workflow, worktree). `project-connect --schema-only` её печатает
(`harness/bin/project-connect:41`, :139), приложение её берёт (`src/main/projects/connect.ts:539`). `profile-set`
проверяет свои поля её правилами (`harness/bin/profile-set:18`).

## Что делаем

- Settings проекта → кнопка «Edit profile». Форма — те же поля, что на шаге Review, плюс поля, которых там нет:
  `tickets.path`, `tickets.spec`, `tickets.trail_section`, `tickets.done_section`, `skills.allowed`, `review.ticket_lenses`,
  `docs.*`, `language.*`, `attribution`, `parallel`, `worktree.*`, `github.account`. Компоненты полей — общие с шагом
  Review (вынести из `ConnectProject.tsx`, а не копировать).
- Запись — только через `profile-set` (ADR-0073), не своим кодом. `profile-set --field` сейчас принимает только
  `workflow.agents` и `agents`; расширить его на любое поле Profile-а, кроме `mode`, `workflow.folder` и `name`, с той же
  проверкой правилами `draft.schema.json` и тем же `--expect <fingerprint>`.
- Сломанная правка отклоняется до записи: форма проверяет значение схемой (`--schema-only`, как шаг Review) и
  показывает причину у поля; `profile-set` проверяет ещё раз и при отказе (exit 1) его текст виден у поля. Файл не
  меняется.
- Profile изменился между чтением и записью (чужой fingerprint) — отказ «The profile changed since you opened it»,
  форма перечитывается.
- Смена `github.account` идёт через тот же шаг «GitHub account» (`src/renderer/projects/GithubAccount.tsx`): он
  проверяет право push, как при подключении.
- `mode` и `workflow.folder` форма показывает без правки, с пометкой «Changed by moving the workflow files» — это
  ticket 81 (перенос Full ↔ Silent).

## Готово, когда

- [ ] «Edit profile» открывает форму с текущими значениями всех полей из списка.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/edit-profile.test.tsx` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-edit.test.ts` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
  - evidence: gate pass · `gate fast` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
- [ ] Правильная правка записана через `profile-set`; `bin/profile` печатает новое значение; commit в git Harness-а.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-edit.test.ts` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
  - evidence: test-run pass · `bash harness/bin/tests/profile-set.test.sh` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
- [ ] Значение против схемы (пустая команда `verify`, `tickets.path` без `NN`, неизвестный `workflow.finish`) отклонено
  с причиной у поля; `profile.json` не изменился.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-edit.test.ts` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/edit-profile.test.tsx` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
  - evidence: test-run pass · `bash harness/bin/tests/project-connect.test.sh` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
- [ ] Чужой fingerprint — отказ, форма перечитана.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/edit-profile.test.tsx` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-edit.test.ts` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
- [ ] `mode` и `workflow.folder` в форме не правятся.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/edit-profile.test.tsx` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
  - evidence: test-run pass · `bash harness/bin/tests/profile-set.test.sh` exit 0 · mac - · 1c466158679c31d70e2b63125ef6aa96f6c5b794
- [ ] `docs/features/projects.md` (и перевод в `docs/features/ru/`) описывает «Edit profile».
  - evidence: commit pass · Edit profile: every Profile field after the connection (worfy-polish 78) · - - · 00780e604

## Тесты

- `harness/test/` — `profile-set --field` для новых полей: запись, отказ схемой, чужой fingerprint, отказ на `mode`.
- unit (jsdom) формы: значения, причина отказа у поля, отказ fingerprint-а.
- contract IPC: правка идёт только через `profile-set` (stub скрипта), worfy не пишет `profile.json` сам.

## Где в коде

- `src/main/projects/settings.ts:31`, :44 — собственные настройки worfy (только читаются: это не Profile).
- `src/renderer/shell/ProjectSettings.tsx:135`, :171 — экран настроек Project-а, место кнопки «Edit profile».
- `harness/bin/profile-set:2–19` — поля и правила; расширение `--field`.
- `src/main/ipc/pipeline.ts:55`, `src/main/ipc/plan-preset.ts:81`, `src/main/ipc/eco-mode.ts:27` — образец вызова
  `profile-set`.
- `src/renderer/projects/ConnectProject.tsx:605–745` — поля шага Review (вынести общие).
- `src/renderer/projects/GithubAccount.tsx` — шаг выбора аккаунта.
- `harness/profiles/draft.schema.json`; `harness/bin/project-connect:41`, :139 — `--schema-only`;
  `src/main/projects/connect.ts:539` — чтение схемы приложением.
- `docs/features/projects.md`, `docs/features/ru/projects.md`.

## Вне скоупа

- `mode` и `workflow.folder` — ticket 81.
- `name` Project-а: на нём держатся папка Profile-а, `runs/<name>` и записи registry Gate; переименование — отдельный
  вопрос.
- Записи registry Gate (`gate[i].root`, `match`): их меняет `project-connect`, не `profile-set`.
- Правка `rules.md` после подключения.

## Итог

- В «Project settings…» — раздел «Profile» с кнопкой «Edit profile…» (`src/renderer/shell/ProjectSettings.tsx`). Она
  открывает форму поверх диалога (`src/renderer/projects/EditProfile.tsx`): поля шага Review (title, команды, ветка
  тикета, finish, линзы ревью, MCP servers, три языка, attribution, GitHub account) и поля, которых там нет:
  `tickets.path`, `tickets.spec`, `tickets.trail_section`, `tickets.done_section`, `skills.allowed`,
  `review.ticket_lenses`, `docs.adr_dir`, `docs.adr_status_label`, `docs.feature_pages`, `docs.context.path`,
  `docs.handoff.path`, `parallel`, `worktree.*`. Список — `PROFILE_EDIT_FIELDS` в `src/shared/ipc/profile-edit.ts`.
  `mode` и Workflow folder — текстом с пометкой «Changed by moving the workflow files»; `name` — текстом.
- Поля вынесены из `ConnectProject.tsx`, а не скопированы: компоненты — `src/renderer/projects/ProfileFields.tsx`,
  стили и чтение/запись пути — `src/renderer/projects/profile-fields.ts`. Шаг Review работает на них же.
- Каналы `profileEdit.read`, `profileEdit.check`, `profileEdit.write` (`src/main/ipc/profile-edit.ts`) — `project`, как
  `ecoMode`: чтение и проверка — `read`, запись — `write`. Все три — только запуск `bin/profile-set --field <поле>…`;
  main передаёт ровно поля `PROFILE_EDIT_FIELDS`, лишние ключи окна (`mode`, `name`) отбрасываются.
- `harness/bin/profile-set --field` принимает любое поле Profile-а через точку, кроме `name`, `mode`, `schema`,
  `workflow.folder`, `workflow.pipeline` и объекта, который их содержит (`workflow`); их можно только `--read`.
  Значение проверяется правилами `draft.schema.json` для этого поля общим кодом `harness/lib/draft-schema.cjs` (им же
  теперь проверяет черновик `bin/project-connect`). Новый режим `--check` — та же проверка без записи. Отказ — exit 1,
  `{ ok: false, errors: [{ path, message }] }` в stdout и по строке на ошибку в stderr; форма показывает его у поля.
  `--expect <fingerprint>` и commit в git Harness home — как раньше.
- Смысл `null` для новых полей: отсутствующее поле остаётся отсутствующим; присутствующее удаляется, если схема не
  требует его в своём объекте, иначе пишется `null` и проверяется схемой. Объект на пути (`docs: null`) создаётся;
  объект другого типа (старая строковая форма `language: "ru"`) — отказ «change it by hand first».
- В `draft.schema.json` добавлены правила, которых требовали примеры тикета: `commands.verify` — `minLength: 1`
  (пустая строка — «must not be empty»), `tickets.path` — `pattern: "NN"`. Неизвестный `workflow.finish` отказывал и
  раньше (enum). Валидатор теперь понимает `pattern` и не принимает ключи прототипа (`toString`) за поля схемы.
- Чужой fingerprint: отказ «The profile changed since you opened it. …», форма перечитывает Profile и показывает его
  текущим (правки поверх старого снимка сброшены).
- «Change account…» открывает тот же шаг `GithubAccount.tsx` с новым prop `initial` — аккаунт Profile-а остаётся
  выбранным, пока gh его знает; выбор задаёт `github.account` и `workflow.finish` по праву push.
- Документы: `docs/features/projects.md` и перевод `docs/features/ru/projects.md`; строка `profile-set` в
  `docs/features/harness.md` и `docs/features/ru/harness.md`; `harness/profiles/README.md`, `harness/lib/README.md`.
- Тесты: `harness/bin/tests/profile-set.test.sh` (новые поля: запись, отказ схемой и в `--set`, и в `--check`, чужой
  fingerprint, отказ на `mode`/`name`/`schema`/`workflow.folder`/`workflow.pipeline`/`workflow`, смысл `null`,
  вложенные имена, закрытое схемой поле, `__proto__`, строковый `language`); `harness/bin/tests/project-connect.test.sh`
  (пустой `verify`, путь без `NN`); `test/unit/edit-profile.test.tsx` (jsdom: значения, отказ у поля, fingerprint,
  аккаунт, Esc, старый Harness); `test/contract/profile-edit.test.ts` (настоящий `bin/profile-set` во временном
  Harness home и stub скрипта: worfy сам `profile.json` не пишет); `test/e2e/edit-profile.spec.ts`.
- Решено без владельца: `workflow.pipeline` через `--field` не пишется (у него свой вызов); `schema` тоже закрыт;
  `language.*` и `attribution` можно вернуть к умолчанию пунктом «default»; поле-список, однажды записанное, отсюда не
  удаляется (пустой ввод пишет `[]`).
- ADR-0073 (пункт 1: «узкий: только `workflow.pipeline`») этим тикетом расширен на любое поле, кроме перечисленных;
  поправку ADR делает Orchestrator.
- Mutation testing в отдельной копии под /tmp (`git worktree add --detach` + `pnpm install --frozen-lockfile`):
  31 mutant, по одному на новый test — все убиты (Escape-test усилен после выжившего mutant-а: без
  `stopPropagation` клавиша доходила до `document`).
- `test/e2e/edit-profile.spec.ts` локально не прогнан: экран Mac был заблокирован (`IOConsoleLocked`) всё время работы —
  e2e: deferred to gate full: screen locked. Его гоняет CI (`ci-ok`). Снимков диалога в тёмной теме поэтому нет.
- Полный `pnpm test` под нагрузкой один раз упал на timeout-е `beforeAll` `test/unit/affected-tests.test.ts` (30 s);
  отдельно — зелёный (113 s), в gate fast — зелёный.
