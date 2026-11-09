# 01 — `ticket`: несколько `--repo`, `PR: <repo>#N`, `ticket pr`, `ticket release`, `done` только с полным набором PR

Type: task
Status: claimed 2026-11-09T18:58Z
Blocked by: —
Source: [spec.md](../spec.md), «Как работает» → «Шапка Ticket-а (Ticket 01; Q1, Q2)»; «Решено без владельца»; «Ticket-ы»,
«Волны» (Wave 1); «Решения владельца 2026-11-09», Q1–Q4; [ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md),
пункты 1–3, 9; места из [Ticket 80 Epic-а worfy-polish](../../worfy-polish/issues/80-один-ticket-на-несколько-репозиториев.md)

Платформенный Ticket: скрипт Harness (`harness/bin/ticket`) идёт на Mac и Windows; Windows verdict до merge
(ADR-0056). Глубина ревью — `high`.

## Что происходит

- `harness/bin/ticket:577` — `Branch:` и `Repo:` по одной строке, существующая заменяется на месте; :13 — `--repo`
  пишет одну строку `Repo: R`.
- :541 — `PR:` одно значение `#N`; :10 — `ticket done --pr N` принимает один номер.
- :976 — `markRepo`: первый `Repo:` даёт один каталог для отметки статуса.
- Формат шапки описан в `harness/bin/TICKETS.md`.

## Что делаем

Формат шапки — из spec-а, раздел «Шапка Ticket-а»:

```
Status: claimed 2026-11-10T09:00Z
Branch: fix/lot-withdraw-flag
Repo: lib
Repo: app
PR: lib#41
PR: app#118
Release: lib tag lib-v1.4.0
```

1. **`Repo:` — по строке на репозиторий** (Q1), имя из `_resolved.repos` Profile-а. Порядок строк — порядок merge-а:
   библиотека первой, потребители после неё (Q3). `ticket claim … --repo A --repo B` пишет обе строки в этом порядке.
2. **`Branch:` — одна строка, одно имя во всех репозиториях** (Q2).
3. **`PR:` — по строке на PR, с именем репозитория**: `PR: <repo>#N`. `ticket pr <epic> <NN> <repo>#N` дописывает
   строку, когда PR открыт. Голый `#N` у Ticket-а с несколькими `Repo:` — ошибка формата: CLI отказывает (номера PR в
   разных репозиториях совпадают). Ticket с одним репозиторием пишет `PR: #N`, как сегодня.
4. **`Release:` — чего ждёт потребитель**: `ticket release <epic> <NN> <repo> tag <tag>` или
   `ticket release <epic> <NN> <repo> package <name>@<version>` дописывает строку `Release: <repo> tag <tag>` или
   `Release: <repo> package <name>@<version>`. Строк может быть несколько. Других видов нет (раздел «Решено без
   владельца»).
5. **`ticket done --pr <repo>#N`** повторяется на каждый PR и отказывает (exit 2), если в наборе нет PR какого-то
   `Repo:` (Q4, ADR-0104 пункт 9). Нового статуса нет.
6. `ticket evidence … --sha S` получает `--repo R`.
7. `markRepo` отмечает статус в Workflow folder, как сейчас.
8. `TICKETS.md`: новые строки шапки и команды; правило «пути в `## Где в коде` Ticket-а с несколькими `Repo:`
   начинаются с имени репозитория» (`app/src/lots.ts`, раздел «Решено без владельца»).
9. Ticket с одной строкой `Repo:` или без неё — как сегодня, байт в байт.

## Готово, когда

- [ ] Test: `ticket claim … --repo lib --repo app` пишет две строки `Repo:` в порядке аргументов и одну `Branch:`.
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh` exit 0 · mac - · 8ea1bd3530c2d01079cff3f537b631abd01809b5
- [ ] Test: `ticket pr` дописывает `PR: <repo>#N`; голый `#N` у Ticket-а с двумя `Repo:` — отказ, файл не меняется.
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh` exit 0 · mac - · 8ea1bd3530c2d01079cff3f537b631abd01809b5
- [ ] Test: `ticket release` пишет `Release:` обоих видов; неизвестный вид — отказ.
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh` exit 0 · mac - · 8ea1bd3530c2d01079cff3f537b631abd01809b5
- [ ] Test: `ticket done` без PR одного из `Repo:` — exit 2, файл не меняется; с PR каждого `Repo:` — `done`.
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh` exit 0 · mac - · 8ea1bd3530c2d01079cff3f537b631abd01809b5
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh` exit 0 · mac - · c01a93ce54ef6330935d53715d5a6dcbe00f06be
- [ ] Test: `ticket evidence … --repo R --sha S` пишет строку evidence с репозиторием.
  - evidence: test-run pass · `bash harness/bin/tests/ticket-evidence.test.sh` exit 0 · mac - · 8ea1bd3530c2d01079cff3f537b631abd01809b5
- [ ] Test: Ticket с одним репозиторием — те же выходы и файлы, что до правки (`PR: #N`, `done --pr N`).
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh` exit 0 · mac - · 8ea1bd3530c2d01079cff3f537b631abd01809b5
- [ ] `TICKETS.md` описывает шапку из spec-а и все новые команды.
  - evidence: commit pass · ticket: several Repo: lines, PR: <repo>#N, ticket pr, ticket release, done only with every PR · - - · 8ea1bd3530c2d01079cff3f537b631abd01809b5
- [ ] `bash harness/bin/tests/ticket-header.test.sh`, `ticket-mark.test.sh`, `ticket-evidence.test.sh` — exit 0 на Mac.
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh`, `ticket-mark.test.sh`, `ticket-evidence.test.sh` exit 0 · mac - · 8ea1bd3530c2d01079cff3f537b631abd01809b5
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh`, `ticket-mark.test.sh`, `ticket-evidence.test.sh` exit 0 · mac - · c01a93ce54ef6330935d53715d5a6dcbe00f06be
- [ ] Те же test-ы на Windows (Git Bash) — exit 0.
  - needs: windows
- [ ] `ci-ok` на PR зелёный.

## Тесты

- `harness/bin/tests/ticket-header.test.sh`, `harness/bin/tests/ticket-mark.test.sh`,
  `harness/bin/tests/ticket-evidence.test.sh`.
- Сначала падающий: `ticket claim … --repo lib --repo app` на `main` оставляет одну строку `Repo:`.

## Где в коде

- `harness/bin/ticket`
- `harness/bin/TICKETS.md`
- `harness/bin/tests/ticket-header.test.sh`
- `harness/bin/tests/ticket-mark.test.sh`
- `harness/bin/tests/ticket-evidence.test.sh`
