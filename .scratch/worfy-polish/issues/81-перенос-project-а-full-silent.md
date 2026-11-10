# 81 — Перенос Project-а Full ↔ Silent

Type: task
Status: blocked 2026-11-10T08:20Z
Blocked reason: three review rounds used (#1770); one medium left: the copy check after a killed move refuses forever with a symlink or eol=crlf — owner decides: a 4th round or merge with a follow-up ticket
Waits: owner
Branch: worfy-polish/81
Blocked by: 78
Source: решение владельца 2026-11-09, Q6: перенос — отдельный ticket, низкий приоритет, после ticket-а 78 и после
Epic-а `worfy-multi-repo-ticket`. Описание переноса вынесено из ticket-а 79 (раздел «Перенос»). Строки перечитаны по
main `964061f9a`.

**Ждёт Epic `worfy-multi-repo-ticket` целиком** (решение владельца 2026-11-09, Q6): низкий приоритет.

## Что происходит

**`mode` задаётся один раз, при подключении.** Шаг Mode диалога Add project
(`src/renderer/projects/ConnectProject.tsx`); Full для папки над несколькими репозиториями отклоняют
`src/main/projects/connect.ts:569` и `harness/bin/project-connect:598`. Workflow folder по умолчанию —
`<папка Profile-а>/workflow` (`harness/bin/project-connect:557`, :608), своя — :613; Full требует
`workflow.folder: null` (:606).

**Profile пишет только скрипт Harness-а** (ADR-0073): `harness/bin/profile-set`, с `--expect <fingerprint>` и
commit-ом в git Harness-а. `mode` и `workflow.folder` он не пишет; ticket 78 расширяет `--field` на остальные поля
Profile-а, а эти два оставляет только для показа с пометкой «Changed by moving the workflow files».

**Переноса нет.** Файлы workflow Project-а в Full mode — в репозитории (ticket-ы, `spec.md`, ADR, файл состояния), в
Silent mode — в Workflow folder вне репозитория (ADR-0042). Поменять режим подключённого Project-а можно только
удалением и новым подключением, а ticket-ы при этом переносить руками.

## Что делаем

- Действие переноса в настройках Project-а, рядом с полем `mode` формы «Edit profile» (ticket 78).
- **Full → Silent:** ticket-ы, `spec.md`, ADR и файл состояния переезжают из репозитория в Workflow folder; в
  репозитории — commit удаления этих файлов, в Workflow folder — commit добавления. `mode: silent` и
  `workflow.folder` пишутся через `profile-set` (ADR-0073), с `--expect <fingerprint>`.
- **Silent → Full:** обратный путь; `mode: full`, `workflow.folder: null` — тоже через `profile-set`. Для Project-а над
  несколькими репозиториями запрещён (ADR-0045: такой Project — всегда Silent mode).
- **Отказ до любой записи**, с причиной:
  - незакоммиченные изменения в репозитории или в Workflow folder;
  - у Project-а работает Session;
  - у ticket-ов Project-а открыты PR.
- **История git читается:** файлы переезжают целиком, по одному commit-у с каждой стороны; сообщение commit-а
  называет, куда (или откуда) переехали файлы. Сбой на середине — откат обеих сторон и Profile-а, Project остаётся в
  прежнем режиме.

## Готово, когда

- [ ] Full → Silent: файлы workflow в Workflow folder, в репозитории их нет; `bin/profile` печатает `mode: silent` и
  новый `workflow.folder`; commit в репозитории, в Workflow folder и в git Harness-а.
- [ ] Silent → Full: обратный путь проходит; для Project-а над несколькими репозиториями — отказ.
- [ ] Незакоммиченные изменения, работающая Session или открытый PR ticket-а — отказ с причиной; ни один файл и
  Profile не изменились.
- [ ] Сбой на середине переноса — обе стороны и Profile как до переноса.
- [ ] `docs/features/projects.md` (и перевод в `docs/features/ru/`) описывает перенос.

## Тесты

- `harness/test/` — `profile-set` для `mode` и `workflow.folder` только в составе переноса; чужой fingerprint — отказ.
- contract: перенос на fixture-репозитории в обе стороны; отказы (грязное дерево, Session, открытый PR); откат при
  сбое.
- unit (jsdom): действие переноса и текст отказа.

## Где в коде

- `harness/bin/profile-set` — запись `mode` и `workflow.folder`.
- `harness/bin/project-connect:557`, :598, :606, :608, :613 — `mode` и Workflow folder при подключении (образец правил).
- `src/main/projects/connect.ts:569` — отказ Full для папки над несколькими репозиториями.
- `src/renderer/projects/ConnectProject.tsx` — шаг Mode; `src/renderer/shell/ProjectSettings.tsx` — настройки
  Project-а (форма «Edit profile» из ticket-а 78).
- `docs/features/projects.md`, `docs/features/ru/projects.md`.

## Вне скоупа

- Удаление Project-а — ticket 79.
- Правка остальных полей Profile-а — ticket 78.
- Full mode для Project-а над несколькими репозиториями (ADR-0045).
