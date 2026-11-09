# 78 — «Edit profile»: все поля Profile-а после подключения Project-а

Type: task
Status: open
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
  ticket 79 (удаление Project-а и перенос Full ↔ Silent).

## Готово, когда

- [ ] «Edit profile» открывает форму с текущими значениями всех полей из списка.
- [ ] Правильная правка записана через `profile-set`; `bin/profile` печатает новое значение; commit в git Harness-а.
- [ ] Значение против схемы (пустая команда `verify`, `tickets.path` без `NN`, неизвестный `workflow.finish`) отклонено
  с причиной у поля; `profile.json` не изменился.
- [ ] Чужой fingerprint — отказ, форма перечитана.
- [ ] `mode` и `workflow.folder` в форме не правятся.
- [ ] `docs/features/projects.md` (и перевод в `docs/features/ru/`) описывает «Edit profile».

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

- `mode` и `workflow.folder` — ticket 79.
- `name` Project-а: на нём держатся папка Profile-а, `runs/<name>` и записи registry Gate; переименование — отдельный
  вопрос.
- Записи registry Gate (`gate[i].root`, `match`): их меняет `project-connect`, не `profile-set`.
- Правка `rules.md` после подключения.
