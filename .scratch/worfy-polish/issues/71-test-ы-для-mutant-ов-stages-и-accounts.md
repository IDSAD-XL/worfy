# 71 — Test-ы для выживших mutant-ов: Stage-и и GitHub-аккаунты

Type: task
Status: done 2026-11-08T03:13Z
PR: #1637
Blocked by: —
Source: аудит mutation testing 2026-11-08 (находки M1–M4 уровня medium). Строки перечитаны по main `39b0ee7ac`.

## Что происходит

Mutation testing нашёл четыре места, где поломка кода не роняет ни одного test-а:

1. `src/main/workflow/stages.ts:147-149` — Project над несколькими репозиториями: Ticket проверяется в репозитории своей
   строки `Repo:`. Test-ы `workflow-stages.test.ts` знают только `repos: []`. Выжили mutant-ы «без выбора репозитория»
   и `repos.length > 1` → `> 2`. Последствие: все Stage-и PR, CI, review и merge такого Project-а стоят на месте.
2. `stages.ts:278` — ответ `git merge-base --is-ancestor`. Код уже верный: кешируются только exit code 0 и 1, ошибка
   (commit не скачан, exit code 128) спрашивается снова. Это не bug, а пробел в test-ах: mutant, который кеширует
   любой exit code, выжил. С ним Ticket на Deploy после `git fetch` стоял бы до перезапуска приложения.
3. `src/main/github/accounts.ts:87` — право записи есть только при ответе gh ровно `true`. Test-ы проверяют `true`,
   `false`, 403 и 404, но не `null`, пустой ответ или другой текст. Выжил mutant `!== 'false'`: аккаунт без права
   записи получил бы `pr-green-ci` (ADR-0045: без права записи PR нет).
4. `accounts.ts:112` и `:129` — GitHub Enterprise: origin на хосте, для которого у gh есть аккаунт, и token этого
   хоста (`gh auth token -u <login> --hostname <host>`). Test-ов нет; выжили mutant-ы «только github.com» и «без
   `--hostname`», а также проверка «репозиторий на другом хосте» (`:139`).

## Что делаем

1. Test: Project над двумя репозиториями, Ticket-ы с разными `Repo:` — PR каждого читается в его репозитории и даёт ему
   Stage; корень, хоть он и git work tree, не спрашивается.
2. Test: `merge-base --is-ancestor` сначала отвечает 128, потом 0 — на втором чтении Ticket проходит Deploy.
3. Test: ответы gh `null`, пустая строка и другой текст — нет права записи, финиш `local-green`. Stand-in gh
   (`test/fixtures/gh/gh-stub.mjs`) отдаёт такие ответы из `repos.json`.
4. Test: origin на `ghe.example.com` и второй репозиторий на `github.com` — оба хоста считаются GitHub-ом, token
   берётся для своего хоста, аккаунт одного хоста не имеет права записи в репозиторий другого. Stand-in gh отказывает
   в token-е логину, которого нет на запрошенном хосте, как настоящий gh.

Код приложения не меняется. Глубина review — `low`. Не платформенный: только test-ы и stand-in gh.

## Готово, когда

- [ ] Test Project-а над двумя репозиториями красный на обоих mutant-ах M1 и зелёный на исходном коде.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-stages.test.ts` exit 0; mutants drop routing and repos.length > 2: exit 1, the new test red · mac - · a5e8525b81962be48a575096ed865ade33cd6e5f
- [ ] Test повторного `merge-base` красный на mutant-е M2 и зелёный на исходном коде.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-stages.test.ts` exit 0; mutant cache any exit code: exit 1, the new test red · mac - · a5e8525b81962be48a575096ed865ade33cd6e5f
- [ ] Test ответов `null`, пустого и другого текста красный на mutant-е M3 и зелёный на исходном коде.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/github-accounts.test.ts` exit 0; mutant !== false: exit 1, the new test red · mac - · a5e8525b81962be48a575096ed865ade33cd6e5f
- [ ] Test GitHub Enterprise красный на обоих mutant-ах M4 и на mutant-е без проверки хоста (`:139`), зелёный на
      исходном коде.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/github-accounts.test.ts` exit 0; mutants github.com only, no --hostname, no host guard: exit 1, new tests red · mac - · a5e8525b81962be48a575096ed865ade33cd6e5f
- [ ] Все unit и contract test-ы `src/main/workflow/stages.ts` и `src/main/github/accounts.ts`, gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0; 16 test files of stages, accounts and the gh stand-in exit 0 · mac - · a5e8525b81962be48a575096ed865ade33cd6e5f
- [ ] `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42438701856/job/128610811664 · ci - · 49359f3f1a2e1a3b0d45b179f56520e89fac667c

## Где в коде

- `src/main/workflow/stages.ts:143-153` — выбор репозитория Ticket-а; `:266-279` — `isAncestor` и его кеш.
- `src/main/github/accounts.ts:84-91` — `pushAccess`; `:112` — хосты GitHub; `:127-145` — token хоста и проверка хоста.
- `test/contract/workflow-stages.test.ts` — новые test-ы M1 и M2.
- `test/contract/github-accounts.test.ts` — новые test-ы M3 и M4.
- `test/contract/gh-world.ts` — тип `StubRepos` принимает `null` и строку.
- `test/fixtures/gh/gh-stub.mjs` — ответ `null` и строки из `repos.json`; token только для логина своего хоста.
