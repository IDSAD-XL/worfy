# 76 — Старый gh ломает проверку GitHub-аккаунта в диалоге Project-а

Type: bug
Status: claimed 2026-11-09T16:48Z
Blocked by: —
Source: решение владельца 2026-11-09 (отзыв тестера): в диалоге подключения Project-а шаг «GitHub account» показал
«gh auth status failed: unknown flag: --json», хотя в gh вошёл нужный аккаунт. Строки перечитаны по main `964061f9a`.

## Что происходит

Шаг «GitHub account» диалога Add project (`src/renderer/projects/GithubAccount.tsx`) спрашивает main
`projects.connect.accounts`. Main зовёт `readGithubAccounts` (`src/main/github/accounts.ts`), а тот запускает один
`gh auth status --json hosts` и разбирает JSON (`parseAuthStatus`). Флаг `--json` у `gh auth status` появился только в
gh **2.81.0** (release 2025-10-01, PR cli/cli#11544 «Add JSON output to `gh auth status`»; проверено по release notes
`gh api repos/cli/cli/releases`). gh старше 2.81 отвечает «unknown flag: --json», exit code не 0, и шаг показывает
`failed` с текстом gh. Аккаунт при этом есть, и выбрать его нельзя: без аккаунта Project не получает финиш с PR.

Экран First run / Health check (`src/main/first-run/checks.ts`) тот же gh читает без `--json`: `ghAuth` запускает
`gh auth status` и разбирает текст (`ghAccounts`, regex `Logged in to (\S+) (?:account|as) ([A-Za-z0-9-]+)`). Поэтому
Health check у тестера зелёный, а диалог Project-а — красный. Проверки версии gh перед `--json` нет: `gh --version`
есть только строкой версии на экране First run.

## Что делаем

Рекомендация — **запасной разбор текста**, а не требование версии. Причины: у тестера вошёл нужный аккаунт, и
просить его обновить gh ради одного флага — лишний шаг; текстовый вывод `gh auth status` с несколькими аккаунтами
стабилен с gh 2.40.0 (release notes 2.40.0: «seeing multiple accounts with `gh auth status`»), и экран First run уже
его читает.

- `readGithubAccounts`: если `gh auth status --json hosts` упал с «unknown flag: --json» (или «unknown flag» вообще),
  второй запуск — `gh auth status` без флагов, stdout и stderr вместе (старый gh пишет в stderr, 2.40+ — в stdout).
- Разбор текста — одна функция, общая с `ghAccounts` из `checks.ts` (перенести её туда, где её возьмут оба, без
  зависимости `github/` от `first-run/`). Из текста берутся `login`, `host`, `active` (строка «Active account: true» под
  аккаунтом; нет строки — у host-а один аккаунт, он активный) и `state` (строка «✓ Logged in…» — `success`, «X Failed to
  log in…» — не `success`). Результат — тот же `HostAccount[]`, что у `parseAuthStatus`; дальше код не меняется.
- Текст не дал ни одного аккаунта — прежний `failed`, но с понятной причиной и командой обновления:
  «gh <версия> is too old to list accounts: update it with `brew upgrade gh` (gh 2.40 or later)». Версию даёт
  `gh --version`; на Windows команда — та, что `installCommand` уже называет для gh.
- `gh auth token -u <login>` (`accountAuth`, `src/main/github/prs.ts`) нужен и после разбора текста. Флаг `-u/--user`
  есть в gh не позже 2.46.0 (release notes 2.46.0 уточняют его описание); точную версию его появления по release notes
  подтвердить не удалось, вероятно 2.40.0 вместе с несколькими аккаунтами. Ниже 2.40 шаг честно пишет «too old».

Альтернатива — сразу требовать gh 2.81+ с командой обновления. Дешевле в коде, но ломает шаг тем, у кого gh из
дистрибутива Linux или старого brew; не выбрана.

## Готово, когда

- [ ] Stub gh, который на `auth status --json hosts` отвечает «unknown flag: --json» (exit 1), а на `auth status` —
  текстом старого формата: шаг «GitHub account» находит аккаунт, его host, active и state.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/gh-auth-text.test.ts test/contract/github-accounts.test.ts` exit 0 · mac - · 7c3d148ed428e9a90c00ad8d23cc36f1d86b6078
  - evidence: gate pass · `gate fast` exit 0 · mac - · 7c3d148ed428e9a90c00ad8d23cc36f1d86b6078
- [ ] Stub gh нового формата (JSON): прежний результат, второго запуска `gh auth status` нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/gh-auth-text.test.ts test/contract/github-accounts.test.ts` exit 0 · mac - · 7c3d148ed428e9a90c00ad8d23cc36f1d86b6078
- [ ] Текст без аккаунтов: причина называет версию gh и команду обновления.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/gh-auth-text.test.ts test/contract/github-accounts.test.ts` exit 0 · mac - · 7c3d148ed428e9a90c00ad8d23cc36f1d86b6078
- [ ] Health check (`ghAccounts`) разбирает те же образцы текста так же, как раньше.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/gh-auth-text.test.ts test/contract/github-accounts.test.ts` exit 0 · mac - · 7c3d148ed428e9a90c00ad8d23cc36f1d86b6078

## Тесты

- `test/contract/github-accounts.test.ts` — новые случаи на stub gh (`test/contract/gh-world.ts`, `authStatus`): старый
  gh с «unknown flag: --json» и текстом с одним и двумя аккаунтами на github.com; новый gh с JSON.
- unit на разбор текста: образцы вывода 2.39 (stderr, «Logged in to github.com as X»), 2.40+ (stdout, «account X»,
  «Active account: true/false»), строка «X Failed to log in».

## Где в коде

- `src/main/github/accounts.ts:105` — `deps.gh(['auth', 'status', '--json', 'hosts'], cwd)` в `readGithubAccounts`
  (:96); :110 — текст «gh auth status failed: …»; `parseAuthStatus` — :37–54, ошибки «printed no JSON» :42 и «printed
  no hosts» :45; схемы `hostAccountSchema` :30 и `authStatusSchema` :31.
- `src/main/github/accounts.ts:132` — `accountAuth` (`gh auth token -u <login>`), :156 — выбор активного аккаунта.
- `src/main/first-run/checks.ts:499–503` — `ghAccounts`, разбор текста; :505–512 — `ghAuth`, `gh auth status` без
  `--json`; :367 — `gh --version` строки версии.
- `src/main/projects/connect.ts:470` — вызов `readGithubAccounts`; `src/renderer/projects/GithubAccount.tsx:129` —
  показ `step.reason` при `failed` (только читается).
- `test/contract/github-accounts.test.ts`, `test/contract/gh-world.ts:39` (`authStatus`) — stub gh.

## Вне скоупа

- Обновление gh за пользователя: worfy называет команду, запускает её пользователь.
- Остальные вызовы gh с `--json` (`gh pr list --json` и др.): этот флаг у них намного старше, отказов не видели.

## Итог

- Разбор текста `gh auth status` вынесен в `src/main/github/auth-text.ts` (модуль без import-ов): `parseAuthText`
  даёт `login`, `host`, `active`, `state`; `ghAccounts` Health check-а теперь берёт его оттуда, `checks.ts` только
  импортирует и реэкспортирует функцию (`github/` от `first-run/` не зависит).
- `readGithubAccounts`: на «unknown flag» от `gh auth status --json hosts` — `gh --version`, затем `gh auth status`
  без флагов, stdout и stderr вместе (новый режим `'all'` у `GhRunner`, `src/main/github/prs.ts`; exit code не 0 —
  `GhExitError` с тем же текстом: gh выходит с 1, когда вход одного аккаунта не удался или не вошёл никто).
- Разбор следует `pkg/cmd/auth/status/status.go` gh 2.40+: «Logged in» — `success`, «Failed to log in» — `error`,
  «Timeout trying to log in» — `timeout`. Строка «Active account» относится только к entry, которую только что
  прочли: entry без login («using token (GH_TOKEN)») и любая другая строка с ✓ или X сбрасывают текущий аккаунт.
- gh старше 2.40 — сразу `failed` «gh <версия> is too old to list accounts: update it with brew upgrade gh (gh 2.40 or
  later)», на Windows — `winget upgrade GitHub.cli`: у такого gh нет `gh auth token -u`, без него доступ к репозиторию
  не проверить. Текст без аккаунтов и без «not logged into any GitHub hosts»: exit code не 0 — «gh auth status failed:
  <первая непустая строка>»; exit code 0 — «gh <версия> printed no account worfy can read: update it with … (gh 2.81 or
  later lists them as JSON)».
- Причина «gh not found» на Windows называет `winget install GitHub.cli` вместо `brew install gh`.
- Решено без владельца: текст «You are not logged into any GitHub hosts» — пустой список аккаунтов (как JSON нового gh
  без аккаунтов), а не «too old»: у gh 2.40–2.80 без входа причина не в версии, а шаг предлагает «Sign in with gh».
- Login в разборе текста принимает и `_` (managed users GitHub Enterprise); прежний regex Health check-а обрезал бы
  такой login.
- Stub gh (`test/fixtures/gh/gh-stub.mjs`) понимает `old-gh.json` и `--version`; `gh-world.ts` — `oldGh` и
  `authStatusText`. Страница `docs/features/projects.md` дополнена.
