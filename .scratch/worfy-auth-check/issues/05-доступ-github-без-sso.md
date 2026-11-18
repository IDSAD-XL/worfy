# 05 — GitHub access: источник токена, честный `gh-auth`, строка Project-а с 401 и 404, «Use <login>»

Type: task
Status: claimed 2026-11-18T20:55Z
Blocked by: 01, 03
Source: [spec.md](../spec.md), «Ticket-ы», 5; «Проблема», пункты «Чей токен у gh» и «Health check»; «Решение»,
пункты 1 и 7; «Починка»; «Решения по реализации», 3; «Решения по test-ам»; «Решения владельца», Q5;
[critic 2026-11-18](../../../docs/product/critic/worfy-auth-check-2026-11-18.md), возражения 1 и 3

Кто: агент.

Платформенный Ticket (ADR-0056, пункт 2): источник токена на macOS и Windows разный (`launchctl setenv` против
registry, ADR-0057), а `src/main/first-run/checks.ts` и `src/main/github/prs.ts` держат ветки по платформе. Вердикт
Windows — job Windows в составе `ci-ok` (ADR-0071). Глубина ревью — `medium`.

## Что происходит

- `gh-auth` читает `gh auth status` и зелёный, если найден хоть один login (`src/main/first-run/checks.ts:502-508`).
  Запись токена из окружения gh печатает с пометкой `(GH_TOKEN)`, а без login она пропускается
  (`src/main/github/auth-text.ts:12-13`, `:31`). Что gh взял токен из окружения, строка не говорит.
- `github.account` пуст или невалиден — только `console.warn` (`src/main/workflow/profile.ts:670-694`, строка log —
  `:673`). Без аккаунта `accountAuth` отдаёт `{}` (`src/main/github/prs.ts:175`), и gh идёт с окружением вызывающего.
- PR inbox идёт в gh с окружением login shell или с `WORFY_GH` в test-ах (`src/main/ipc/pr-inbox.ts:73-76`).
- Push-доступ аккаунтов к repo уже считает диалог Project-а (`src/main/github/accounts.ts:155-210`).
- Одно поле Profile worfy пишет через `harness/bin/profile-set --field` (`src/main/ipc/code-stories-setting.ts:3`;
  кнопка Allow MCP — `src/main/ipc/agent.ts:371`); `profile-set` делает commit в Harness home
  (`harness/bin/profile-set:46`). Черновик `src/main/projects/connect.ts` своей записи не имеет — через него не писать
  (возражение 3 critic-а).
- Ticket 01 дал путь `GH_TOKEN` на Mac и ПК, ответы 401 и 404 и fixtures (`.scratch/worfy-auth-check/fixtures/local/`).
  Ticket 03 дал `severity`, `unknown`, строки Project-а, `opensFirstRun: false` и сетевые строки вне решения о старте.

## Что делаем

1. `src/main/github/auth-diagnosis.ts` (новый), без SSO:
   - чей токен возьмёт gh: имена `GH_TOKEN` и `GITHUB_TOKEN` в окружении gh и запись `(GH_TOKEN)` в `gh auth status`;
     только имя переменной, никогда значение;
   - разбор ответа `gh api -i repos/<owner>/<repo>`: 200 — доступ есть; 401 — токен не работает; 404 — нет доступа;
     нет сети, timeout, 5xx — `unknown`. Разбор 403 с `X-GitHub-SSO` и `partial-results` — Ticket 06.
2. `src/main/github/auth-text.ts`: запись `(GH_TOKEN)` / `(GITHUB_TOKEN)` читается как источник токена с её состоянием
   (`success`, `error`); логины разбираются как прежде.
3. `gh-auth` (`checks.ts:502-508`) называет источник: «alice (keyring), GH_TOKEN from the environment overrides it».
4. Строка GitHub access для каждого Project-а этой Machine с origin на GitHub, группа Projects: `readGithubAccount` →
   `accountAuth` → `gh api -i repos/<owner>/<repo>` на каждый repo с тем окружением, с каким gh идёт в PR inbox
   (`ipc/pr-inbox.ts:73-76`). Profile не читается — строка так и говорит. Уровень — из `src/shared/health/severity.ts`
   (Ticket 03), функцию не править. Случаи:
   - аккаунт есть, login есть, доступ ко всем repo — `ok`, detail: login, источник токена, repo;
   - нет gh login аккаунта — critical, шаг «`gh auth login`, войти как `<login>`», кнопка Sign in… (`gh-login`);
   - `github.account` пуст, токен окружения работает — non-critical; ровно один login gh на хосте origin с push во все
     repo — кнопка «Use <login>» (`safe`);
   - `github.account` пуст, токен окружения не работает (401) — critical, шаг «GH_TOKEN comes from your environment»;
     варианты: авторизовать токен, задать `github.account` («Use <login>»), убрать переменную — Copy command
     (`launchctl unsetenv GH_TOKEN` на macOS, команда PowerShell для переменной пользователя на Windows). Переменные
     окружения worfy не меняет никогда;
   - 404 — critical, «no access to <repo> as <login>»;
   - нет сети, timeout, 5xx — `unknown`, «Couldn't check: <reason>».
5. «Use <login>»: щелчок пишет одно поле через `profile-set --field github.account` по образцу
   `code-stories-setting.ts`; commit в Harness home делает `profile-set`. Тихой записи и тихого перехода на keyring нет
   (Q5). После записи — проверка строки заново.
6. Строка регистрирует свою повторную проверку в `health-reports` (Ticket 03): не чаще раза в минуту на Project.
7. Английские страницы: `docs/features/gate-and-github.md` (источник токена, строка GitHub access, «Use <login>»),
   `docs/features/projects.md` (`github.account` и Health check). Перевод — Ticket 09.

## Готово, когда

- [ ] Unit test (новый `test/unit/auth-diagnosis.test.ts`) на fixtures Ticket-а 01, скопированных в
      `test/fixtures/gh-auth/` (scrub: без токенов, организаций и login тестера): источник токена — keyring,
      `GH_TOKEN`, `GITHUB_TOKEN`; 200, 401, 404, 5xx → `unknown`.
  - evidence: test-run pass · `pnpm test test/unit/auth-diagnosis.test.ts` exit 0 · mac - · fb5e44b1a13fe981ebdb4fa303b78d173c3305c6
- [ ] Unit test (`test/unit/gh-auth-text.test.ts`): запись `(GH_TOKEN)` читается как источник с состоянием; разбор
      логинов gh до 2.40 и после не изменился.
  - evidence: test-run pass · `pnpm test test/unit/gh-auth-text.test.ts` exit 0 · mac - · fb5e44b1a13fe981ebdb4fa303b78d173c3305c6
- [ ] Contract test (новый `test/contract/health-github-access.test.ts`) на stand-in gh (`test/fixtures/gh/gh-stub.mjs`,
      `WORFY_GH`): нет аккаунта и один login с push → fixable с «Use <login>»; два login-а с push → needs-user без
      кнопки; аккаунт без gh login → critical с Sign in…; 401; 404; stand-in падает без сети → `unknown`.
  - evidence: test-run pass · `pnpm test test/contract/health-github-access.test.ts` exit 0 · mac - · fb5e44b1a13fe981ebdb4fa303b78d173c3305c6
- [ ] Contract test: «Use <login>» зовёт `profile-set --field github.account` с этим login-ом, следующая проверка
      строки — `ok`; `gh-auth` с `(GH_TOKEN)` называет переменную.
  - evidence: test-run pass · `pnpm test test/contract/health-github-access.test.ts test/unit/settings-health.test.tsx` exit 0 · mac - · fb5e44b1a13fe981ebdb4fa303b78d173c3305c6
- [ ] Test, что ни одна строка, log и текст ошибки не содержат значение токена: stand-in gh печатает известный токен
      (в `gh auth token` и в теле ответа), test ищет его во всём выводе — в отчёте Health check, в log и в ошибках.
  - evidence: test-run pass · `pnpm test test/contract/health-github-access.test.ts` exit 0 (the leak test) · mac - · fb5e44b1a13fe981ebdb4fa303b78d173c3305c6
- [ ] Все unit и contract test-ы модуля зелёные: `test/unit/gh-auth-text.test.ts`, `test/contract/first-run-checks.test.ts`,
      `test/contract/github-prs.test.ts`, `test/contract/github-accounts.test.ts`, `test/contract/gh-stand-in.test.ts`,
      `test/contract/workflow-profile.test.ts`, `test/contract/health-reports.test.ts`.
  - evidence: test-run pass · `pnpm test` of the 12 module files (gh-auth-text, auth-diagnosis, first-run-checks, github-prs, github-accounts, gh-stand-in, workflow-profile, health-reports, health-github-access, settings-health, first-run-dialog, link-access) exit 0 · mac - · fb5e44b1a13fe981ebdb4fa303b78d173c3305c6
- [ ] Английские страницы `gate-and-github.md` и `projects.md` описывают источник токена и строку GitHub access.
  - evidence: commit pass · worfy-auth-check/05: GitHub access row, honest gh-auth, Use <login> · - - · fb5e44b1a13fe981ebdb4fa303b78d173c3305c6
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · fb5e44b1a13fe981ebdb4fa303b78d173c3305c6
  - evidence: gate pass · `gate fast` exit 0 · mac - · fb5e44b1a13fe981ebdb4fa303b78d173c3305c6
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): job Windows в составе `ci-ok` зелёный на head PR до merge.

## Где в коде

- `src/main/github/auth-diagnosis.ts` (новый)
- `src/main/github/auth-text.ts`
- `src/main/first-run/checks.ts` (`gh-auth`, строки Project-а; `ProjectProfile` — `:87-94`, нужны id, root и origin)
- `src/main/first-run/actions.ts` (кнопка «Use <login>»), `src/main/ipc/first-run.ts`
- `docs/features/gate-and-github.md`, `docs/features/projects.md`
- `test/unit/auth-diagnosis.test.ts` (новый), `test/fixtures/gh-auth/` (новый), `test/unit/gh-auth-text.test.ts`,
  `test/contract/health-github-access.test.ts` (новый), `test/fixtures/gh/gh-stub.mjs` (ответ `api -i`, если его нет)

Только читать: `src/main/github/prs.ts`, `src/main/github/accounts.ts`, `src/main/workflow/profile.ts`,
`src/main/ipc/pr-inbox.ts`, `src/main/ipc/code-stories-setting.ts`, `harness/bin/profile-set`,
`src/shared/health/severity.ts`.

## Вне скоупа

- SSO: `X-GitHub-SSO`, `partial-results`, ссылка авторизации — Ticket 06.
- Сообщения PR inbox, PR badges и прочих фич — Ticket 07.
- Scope-ы токена (`repo`, `workflow`) сверх доступа к repo.
- Тексты агенту в Harness: hook `harness/hooks/gh-token-env.mjs` и `harness/bin/preflight` не меняются.
