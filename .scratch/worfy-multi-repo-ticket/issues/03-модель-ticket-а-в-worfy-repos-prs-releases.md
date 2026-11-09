# 03 — Модель Ticket-а в worfy: `repos`, `prs`, `releases`; ветка по паре (repo, branch)

Type: task
Status: claimed 2026-11-09T18:58Z
Blocked by: —
Source: [spec.md](../spec.md), «Как работает» → «Шапка Ticket-а» (формат) и «epic-status, wave-brief, Pipeline board»
(«Модель в worfy», `reader.ts:422`); «Ticket-ы», «Волны» (Wave 1); «Решения владельца 2026-11-09», Q1, Q2;
[ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md), пункты 1–3, 6; места из
[Ticket 80 Epic-а worfy-polish](../../worfy-polish/issues/80-один-ticket-на-несколько-репозиториев.md)

Платформенный Ticket: нет (модель и чтение файла Ticket-а в main, без путей и процессов ОС). Глубина ревью — `medium`.

Читатель формата не ждёт писателя (Ticket 01): формат шапки задан spec-ом, раздел «Шапка Ticket-а».

## Что происходит

- `src/shared/workflow/types.ts:47` — `pr` одно число; :56 — `branch` одна строка; :58 — `repo` одна строка.
- `src/shared/workflow/ticket-ref.ts:32` — `parseTicketBranch`: ветка → один Ticket.
- `src/main/workflow/reader.ts:422` — worktree Project-а, чья ветка называет Ticket.

## Что делаем

1. Модель Ticket-а: `repos: string[]`, `prs: {repo, number}[]`, `releases: {repo, kind, ref}[]` из строк `Repo:`,
   `PR: <repo>#N`, `Release: <repo> tag <tag>` / `Release: <repo> package <name>@<version>` в порядке файла.
2. Старые поля `repo` и `pr` остаются для Ticket-а с одним репозиторием.
3. `Branch:` — одна строка. `reader.ts` ищет ветку Ticket-а по паре (repo, branch) в checkout-е каждого репозитория из
   `repos`.

## Готово, когда

- [ ] Contract test: файл Ticket-а с двумя `Repo:`, двумя `PR: <repo>#N` и `Release:` обоих видов читается в `repos`,
      `prs`, `releases` в порядке файла.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/workflow-reader.test.ts test/unit/ticket-ref.test.ts` exit 0 · mac - · c94da5cd0ecab31ba3afcff60d898fc46a3e925b
- [ ] Contract test: ветка с одним именем в двух checkout-ах находится в обоих и относится к одному Ticket-у.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/workflow-reader.test.ts test/unit/ticket-ref.test.ts` exit 0 · mac - · c94da5cd0ecab31ba3afcff60d898fc46a3e925b
- [ ] Test: Ticket с одним репозиторием — те же `repo` и `pr`, что до правки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/workflow-reader.test.ts test/unit/ticket-ref.test.ts` exit 0 · mac - · c94da5cd0ecab31ba3afcff60d898fc46a3e925b
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · c94da5cd0ecab31ba3afcff60d898fc46a3e925b
  - evidence: gate pass · `gate fast` exit 0 · mac - · c94da5cd0ecab31ba3afcff60d898fc46a3e925b

## Тесты

- Contract `test/contract/workflow-reader.test.ts`; unit `test/unit/ticket-ref.test.ts`.
- Сначала падающий: на `main` у Ticket-а с двумя `Repo:` в модели остаётся один репозиторий.

## Где в коде

- `src/shared/workflow/types.ts`
- `src/shared/workflow/ticket-ref.ts`
- `src/main/workflow/reader.ts`
- `test/contract/workflow-reader.test.ts`
- `test/unit/ticket-ref.test.ts`
