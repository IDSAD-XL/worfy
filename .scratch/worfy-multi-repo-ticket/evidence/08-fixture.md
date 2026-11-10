# 08 — Приёмка Ticket-а из двух репозиториев: evidence

## Fixture-проект (п. 1 «Готово, когда»)

Stub-проект из двух репозиториев — библиотека `lib` и её потребитель `app`, у каждого локальный bare origin, общая
рабочая папка над ними; Silent mode, `parallel: single`, `workflow.merge: null`. `gh` и `npm` — stub-ы fixture
(`harness/bin/tests/fixtures/multi-repo/bin/`): `gh` отвечает на `pr create`, `pr view`, `pr ready` и отказывает
во всём остальном, в том числе в `pr merge`; `npm` отвечает только на `npm view <name>@<version> version`.

- Test: `harness/bin/tests/multi-repo.test.sh`, fixture: `harness/bin/tests/fixtures/multi-repo/`.
- Commit: `ec426a6c7` (ветка `worfy-multi-repo-ticket/08`), Mac, 2026-11-10.
- Команда (HOME — пустая временная папка, как в `pnpm test`):

  ```
  HOME="$(mktemp -d)" bash harness/bin/tests/multi-repo.test.sh; echo "EXIT=$?"
  ```

- Итог: `passed 35, failed 0`, `EXIT=0`.

Путь, который проходит test (spec, «Что видит пользователь», п. 1–7):

1. Ticket с двумя строками `Repo:` (lib первой), одна строка `Branch:`, эта ветка — в checkout-е обоих репозиториев.
2. Один verdict ревью: отметка `review success` на head каждой ветки, в файле отметок Silent mode, без вызова `gh`.
3. PR в каждом репозитории (`lib#41`, draft `app#118`), `ticket pr` на оба, `ticket release` — tag и версия пакета.
4. `ticket done` с PR одного репозитория — exit 2, файл не меняется.
5. `epic-status`: `PR lib#41, app#118 · waits for release lib-v1.4.0, @acme/lots@1.4.0`.
6. Merge библиотеки людьми — «1/2 merged», Ticket остаётся `claimed`; tag на origin и опубликованная версия
   (`git ls-remote`, stub `npm view`) — release замечен; PR потребителя выходит из draft; merge потребителя —
   «2/2 merged»; `ticket done --pr lib#41 --pr app#118` — `done`.
7. Ticket с одной строкой `Repo:` в том же fixture — `PR: #N`, без `repos`/`prs`/`releases` в `epic-status --json`,
   как до Epic-а.

Mutation testing (в отдельной копии): test краснеет, когда `ticket done` пропускает неполный набор PR, когда
`epic-status` не пишет «waits for release» или теряет строку `Release: … package`, когда Ticket с одной строкой
`Repo:` читается как Ticket нескольких репозиториев, когда stub `npm` считает версию опубликованной всегда и когда
`gh pr ready` не снимает draft.

## Настоящий Ticket в рабочем проекте (п. 2 «Готово, когда», ведёт владелец)

Без имён репозиториев, хостов и людей рабочего проекта.

- Дата:
- Сборка worfy (Stable, commit):
- PR (только роль и номер): библиотека — , потребитель —
- Pipeline board: одна карточка — ; «1/2 merged» — ; «waits for release <version>» —
- PR без ссылок друг на друга — 
- `ticket done` — 
- Снимки: 
- Замечания владельца:
