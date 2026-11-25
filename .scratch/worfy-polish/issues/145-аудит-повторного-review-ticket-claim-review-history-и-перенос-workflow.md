# 145 — Аудит повторного review: ticket claim, review-history и перенос workflow

Type: bug
Status: done 2026-11-25T19:11Z
PR: #2223
Branch: worfy-polish/145
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «В Ticket-ы»; checked open on main b0e073620 2026-11-25

Кто: агент. Глубина review — `medium`. Это правка script-ов Harness-а (`harness/bin/`, `harness/lib/`) — платформенный
PR (ADR-0056): вердикт Windows — job-ы Windows в CI.

Четыре finding-а аудита повторного review смёрженных PR (`.scratch/audit-pr-rereview-2026-11-13/spec.md`, номера 21,
97, 113, 114), все в script-ах Harness-а. Каждое проверено на main b0e073620: все четыре ещё открыты; у 21 и 97 часть
уже закрыта (сказано ниже).

## Что происходит

- **21. Дочитывание страниц threads и comments не проверено.** `harness/bin/review-history:407` (`readOn`) дочитывает
  страницы reviews, review threads, comments PR и comments внутри thread (`:421-424`). Test-ом закреплены только
  reviews: fixture `harness/bin/tests/fixtures/review-history/filter/page-1.json` (`hasNextPage: true`) и
  `reviews-41-r2.json`, проверка `OVERFLOW-REVIEW-TEXT` в `harness/bin/tests/review-history.test.sh:168`. Для threads,
  comments и comments thread-а второй страницы нет, хотя stand-in `gh` уже знает имена файлов (`threads-*`,
  `comments-*`, `thread-*`, `review-history.test.sh:99-104`). Сценарий: если сломать `readOn` для threads, team
  reviewer (`/human-review-setup`) учится на PR с длинным обсуждением по первой странице threads, а test-ы зелёные.
- **97. `ticket claim` перезаписывает чужой claim.** Часть про frontier закрыта: `harness/bin/TICKETS.md:458` теперь
  считает frontier только из Ticket-ов в состоянии `open`, `epic-status` выводит его так же. Не закрыто:
  `harness/bin/ticket:678-694` пишет `Status: claimed <time>` поверх любой прежней строки Status, не глядя на неё.
  Сценарий: две Session (или Autopilot и человек) зовут `ticket claim worfy-polish 05` с разными `--branch`; вторая
  молча заменяет claim первой (время и `Branch:`), и обе делают один Ticket. Повторный claim своего Ticket-а нужен:
  `harness/bin/tests/ticket-header.test.sh:228` меняет набор `Repo:` вторым claim-ом.
- **113. Проверка открытых PR при переносе идёт под глобальным аккаунтом gh.** `harness/lib/workflow-move.cjs:195-208`
  (`openPrs`) запускает `gh pr list` с `env: { ...gitEnv(), … }`; `GH_TOKEN` аккаунта Project-а (`github.account` в
  profile, ADR-0020) не передаётся. В Session его ставит hook `harness/hooks/gh-token-env.mjs`, но `profile-set` из
  терминала или из worfy идёт под глобальным аккаунтом. Сценарий: private repository аккаунта Project-а, глобальный
  аккаунт gh его не видит — `gh pr list` падает, и перенос Full ↔ Silent отказан с ошибкой gh, хотя аккаунт Project-а
  всё читает.
- **114. Папка Product Session не переносится.** `workflowPaths` (`harness/lib/workflow-move.cjs:100-130`) берёт
  `tickets.root`, handoff, ADR, `docs.context`, lessons и папки шаблонов Ticket-а и spec; папки Product Session в списке
  нет. Её место задано кодом: `docs/product` в Full mode, `<Workflow folder>/product` в Silent mode
  (`src/shared/product/paths.ts:39-42`). Сценарий: перенос Full → Silent оставляет `docs/product/` (темы, Mind map,
  review critic-а) в публичном repository, а Product Session после переноса открывает пустую папку
  `<Workflow folder>/product` — карта и темы «пропали».

## Что делаем

1. 21: fixtures второй страницы для review threads, comments PR и comments внутри thread-а; test проверяет, что текст
   каждой второй страницы попадает в `raw/`.
2. 97: `ticket claim` Ticket-а в состоянии `claimed`, у которого `Branch:` есть и отличается от `--branch` (или
   `--branch` не дан), отказывает с exit 1 и называет прежнюю branch и время; `--force` перезаписывает. Повторный claim
   с той же `--branch` разрешён, как сейчас. Проверить вызовы `ticket claim` в `harness/skills/` и
   `harness/agents/` (возобновление Wave): им нужен `--branch` или `--force`. `harness/bin/TICKETS.md` — правило
   claim.
3. 113: `openPrs` получает `GH_TOKEN` из `gh auth token -u <github.account>`, как `gh-token-env.mjs`; без аккаунта
   в profile — как сейчас. Token не печатается ни в вывод, ни в ошибку.
4. 114: в план переноса входит пара `docs/product` (Full) ↔ `product` (Silent) с теми же проверками и откатом, что у
   остальных папок; нет папки — нечего переносить. `docs/features/projects.md:39-45` («Moving between the modes») называет её.

## Готово, когда

- [ ] 21: test в `harness/bin/tests/review-history.test.sh` — текст со второй страницы threads, comments PR и comments
      thread-а есть в `raw/`; mutant «не звать `readOn` для `reviewThreads`» (`review-history:422`) — красный.
  - evidence: test-run pass · `bash harness/bin/tests/review-history.test.sh` exit 0; mutants without readOn for reviewThreads, comments, thread comments each exit 1 · mac - · fb1591375c55906323f3b1e1570ebe050f000436
  - evidence: test-run pass · `bash harness/bin/tests/review-history.test.sh` exit 0 (review round 1 head) · mac - · af6a038cd17648c1a706c91b16868a0d33349bdc
  - evidence: test-run pass · `pnpm test` exit 0 inside gate fast, review-history.test.sh in the harness shell suite (review round 2 head) · mac - · 24480d05e80bb293b532d0e1537205d92e7ef0fe
  - evidence: review pass · PR #2223 · - - · 0f78e9a2c4bc38819b1199ff10a5add06901feb2
- [ ] 97: test в `harness/bin/tests/ticket-header.test.sh` — второй `claim` с другой `--branch` — exit 1, Status и
      `Branch:` не изменились; с `--force` — перезаписаны; с той же `--branch` — разрешён. Красный на origin/main.
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh` exit 0; on origin/main code 4 new cases FAIL · mac - · fb1591375c55906323f3b1e1570ebe050f000436
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh` exit 0; the branch read as epic-status reads it (review round 1) · mac - · af6a038cd17648c1a706c91b16868a0d33349bdc
  - evidence: test-run pass · `bash harness/bin/tests/ticket-header.test.sh` exit 0 (review round 2 head) · mac - · 24480d05e80bb293b532d0e1537205d92e7ef0fe
  - evidence: review pass · PR #2223 · - - · 0f78e9a2c4bc38819b1199ff10a5add06901feb2
- [ ] 113: test в `harness/bin/tests/profile-set-move.test.sh` — stand-in `$PROFILE_SET_GH` печатает полученный
      `GH_TOKEN`; при `github.account` в profile это token этого аккаунта. Красный на origin/main.
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0; on origin/main code the github.account token cases FAIL · mac - · fb1591375c55906323f3b1e1570ebe050f000436
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 (review round 1 head) · mac - · af6a038cd17648c1a706c91b16868a0d33349bdc
  - evidence: test-run pass · `pnpm test` exit 0 inside gate fast, profile-set-move.test.sh in the harness shell suite (review round 2 head) · mac - · 24480d05e80bb293b532d0e1537205d92e7ef0fe
  - evidence: review pass · PR #2223 · - - · 0f78e9a2c4bc38819b1199ff10a5add06901feb2
- [ ] 114: test в `harness/bin/tests/profile-set-move.test.sh` — перенос Full → Silent переносит `docs/product/` в
      `<Workflow folder>/product/`, обратный — назад; откат при сбое возвращает её. Красный на origin/main.
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 and `bash harness/bin/tests/profile-set-move-recover.test.sh` exit 0; on origin/main code both FAIL · mac - · fb1591375c55906323f3b1e1570ebe050f000436
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 and `bash harness/bin/tests/profile-set-move-recover.test.sh` exit 0; overlap and product-already-there mutants exit 1 · mac - · af6a038cd17648c1a706c91b16868a0d33349bdc
  - evidence: test-run pass · `pnpm test` exit 0 inside gate fast, profile-set-move and profile-set-move-recover in the harness shell suite (review round 2 head) · mac - · 24480d05e80bb293b532d0e1537205d92e7ef0fe
  - evidence: review pass · PR #2223 · - - · 0f78e9a2c4bc38819b1199ff10a5add06901feb2
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `bash harness/bin/tests/review-history.test.sh`,
      `ticket-header.test.sh`, `profile-set-move.test.sh`, `profile-set-move-recover.test.sh` — exit 0; `ci-ok`
      зелёный на head PR, job-ы Windows CI зелёные (платформенный PR).
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0; the four shell tests exit 0 · mac - · fb1591375c55906323f3b1e1570ebe050f000436
  - evidence: gate pass · `gate fast` exit 0 · mac - · fb1591375c55906323f3b1e1570ebe050f000436
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0; multi-repo, silent-mode, tickets-root, wave-brief, worktree-lock-prune shell tests exit 0 · mac - · af6a038cd17648c1a706c91b16868a0d33349bdc
  - evidence: gate pass · `gate fast` exit 0 (review round 1 head) · mac - · af6a038cd17648c1a706c91b16868a0d33349bdc
  - evidence: test-run pass · `pnpm lint && pnpm typecheck` exit 0; binding, edit-profile, bindings, codex-binding tests exit 0 (review round 2 head) · mac - · 24480d05e80bb293b532d0e1537205d92e7ef0fe
  - evidence: gate pass · `gate fast` exit 0 (review round 2 head) · mac - · 24480d05e80bb293b532d0e1537205d92e7ef0fe
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45675434362/job/139446849347 · ci - · 0f78e9a2c4bc38819b1199ff10a5add06901feb2

## Где в коде

- `harness/bin/review-history:405-425` (`readOn`, `completePull`)
- `harness/bin/tests/review-history.test.sh:95-105`, `:160-170`; `harness/bin/tests/fixtures/review-history/filter/`
- `harness/bin/ticket:600-700` (разбор `claim`, запись Status)
- `harness/bin/tests/ticket-header.test.sh:220-232`
- `harness/bin/TICKETS.md:455-465` (Frontier, Claim)
- `harness/lib/workflow-move.cjs:60-70` (`gitEnv`), `:100-130` (`workflowPaths`), `:190-210` (`openPrs`)
- `harness/bin/tests/profile-set-move.test.sh`, `profile-set-move-recover.test.sh`
- `harness/hooks/gh-token-env.mjs` — только читать (как берётся token аккаунта)
- `src/shared/product/paths.ts:39-42` — только читать (папка Product Session)
- `docs/features/projects.md:39-45`

## Вне скоупа

- Остальные находки `triage.md`.
- Поле владельца (id Session) в строке Status: branch служит меткой claim-а.
