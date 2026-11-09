# 02 — `epic-status` и `wave-brief`: списки `Repo:`, `PR:`, `Release:`; ключи (repo, branch) и (repo, N)

Type: task
Status: claimed 2026-11-09T18:58Z
Blocked by: —
Source: [spec.md](../spec.md), «Как работает» → «Шапка Ticket-а» (формат) и «epic-status, wave-brief, Pipeline board»;
«Ticket-ы», «Волны» (Wave 1); «Ответ на критику», п. 1; «Решения владельца 2026-11-09», Q1–Q4;
[ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md), пункты 1–3, 6; места из
[Ticket 80 Epic-а worfy-polish](../../worfy-polish/issues/80-один-ticket-на-несколько-репозиториев.md)

Платформенный Ticket: скрипты Harness (`epic-status`, `wave-brief`) идут на Mac и Windows; Windows verdict до merge
(ADR-0056). Глубина ревью — `medium`.

Читатель формата не ждёт писателя (Ticket 01): формат шапки задан spec-ом, раздел «Шапка Ticket-а».

## Что происходит

- `harness/bin/epic-status:224` — «the LAST Blocked by / Branch / Repo line wins»; :283 — берёт первый `PR:`; :337 —
  Branch и Repo одним словом.
- `harness/bin/wave-brief:208–209` — `byBranch` и `byPr`: ветка → Ticket, PR → Ticket, по одному.

## Что делаем

1. **epic-status**: `Repo:`, `PR:` и `Release:` — списки в порядке файла; `Branch:` — одна строка. Строка Ticket-а —
   как в spec-е: `PR lib#41 ✓, app#118 · waits for release lib-v1.4.0`. Ticket считается один раз.
2. **wave-brief**: `byBranch` — по паре (repo, branch), `byPr` — по паре (repo, N). Ключи нужны и без `land` через
   несколько репозиториев (критика, возражение 1).
3. Ticket с одной строкой `Repo:` или без неё и `PR: #N` — вывод как сегодня.

## Готово, когда

- [ ] Test: Ticket с двумя `Repo:`, двумя `PR: <repo>#N` и строкой `Release:` — одна строка Ticket-а с обоими PR в
      порядке файла и «waits for release …»; в счёте Epic-а Ticket один.
  - evidence: test-run pass · `bash harness/bin/tests/epic-status.test.sh` exit 0 (section 6, multi-repo line and count) · mac - · ca7df763a3968d9a812a83e81bbd5819206f6555
- [ ] Test: два Ticket-а с одинаковым номером PR в разных репозиториях — `wave-brief` не путает их; одна ветка в двух
      репозиториях — один Ticket.
  - evidence: test-run pass · `bash harness/bin/tests/wave-brief.test.sh` exit 0 (section 10, keys (repo, N) and (repo, branch)) · mac - · ca7df763a3968d9a812a83e81bbd5819206f6555
- [ ] Test: Ticket с одним репозиторием — вывод `epic-status` и `wave-brief` прежний.
  - evidence: test-run pass · `bash harness/bin/tests/epic-status.test.sh` exit 0 (section 1 slice unchanged, section 6 single-repo object) · mac - · ca7df763a3968d9a812a83e81bbd5819206f6555
- [ ] `bash harness/bin/tests/epic-status.test.sh`, `bash harness/bin/tests/wave-brief.test.sh` — exit 0 на Mac.
  - evidence: test-run pass · `bash harness/bin/tests/epic-status.test.sh` and `bash harness/bin/tests/wave-brief.test.sh` exit 0 · mac - · ca7df763a3968d9a812a83e81bbd5819206f6555
- [ ] Те же test-ы на Windows (Git Bash) — exit 0.
  - needs: windows
- [ ] `ci-ok` на PR зелёный.

## Тесты

- `harness/bin/tests/epic-status.test.sh`, `harness/bin/tests/wave-brief.test.sh`.
- Сначала падающий: на `main` Ticket с двумя `PR:` показывает только первый.

## Где в коде

- `harness/bin/epic-status`
- `harness/bin/wave-brief`
- `harness/bin/tests/epic-status.test.sh`
- `harness/bin/tests/wave-brief.test.sh`
