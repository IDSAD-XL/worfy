# 01 — Spike: как `GH_TOKEN` из окружения системы доходит до gh в worfy на Mac и ПК

Type: spike
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 1; «Проблема», пункт «Чей токен у gh»; «Решения по test-ам», fixtures;
«Волны», Wave 1; [critic 2026-11-18](../../../docs/product/critic/worfy-auth-check-2026-11-18.md), возражение 1 и
«Alternative» (локальная часть spike-а отделена от SAML SSO)

Кто: агент; запуски на ПК — Session ПК владельца (Windows).

Платформенный Ticket: опыт идёт на macOS (`launchctl setenv`) и на Windows (`setx`), итог нужен с обеих Machine. Кода
продукта не вливает: PR несёт только `spike.md` и fixtures. Глубина ревью — `low`.

## Что происходит

- С `github.account` gh получает `GH_TOKEN` этого аккаунта поверх окружения: `accountAuth`
  (`src/main/github/prs.ts:172-189`), extra env кладётся поверх env в `ghRunner` (`prs.ts:125-133`). Без аккаунта
  `accountAuth` отдаёт `{}` (`prs.ts:175`), и gh идёт с окружением, которое дал вызывающий.
- PR inbox, gate-queue и Session Codex берут окружение login shell (`src/main/ipc/pr-inbox.ts:73-76`,
  `src/main/ipc/gate-queue.ts:34`, `src/main/vendors/codex/session.ts:1037`). Login shell стартует с коротким списком
  `SHELL_BASE_KEYS` (`src/main/agent/env.ts:35`, `shellBaseEnv` — `:49-56`), в нём нет `GH_TOKEN`.
- Когда `env` не передан, `ghRunner` берёт `process.env` (`prs.ts:125`). Вызовы `ghRunner`: `src/main/ipc/pr-inbox.ts:75`,
  `src/main/ipc/gate-queue.ts:34`, `src/main/ipc/projects.ts:149`, `:176`, `src/main/ipc/checks.ts:166`,
  `src/main/vendors/codex/session.ts:1037`.
- У тестера токен из `launchctl setenv` всё же доходит до gh. Как — не проверено: rc-файл shell-а, `process.env` или
  иначе. На Windows окружение строится из registry (ADR-0057), и `setx GH_TOKEN` доходит прямо.
- Ticket 05 строит по итогу этого Ticket-а «чей токен возьмёт gh» и ответы 401 и 404.

## Что делаем

1. На Mac владельца: `launchctl setenv GH_TOKEN <тестовый токен>` (токен с правами только на чтение, отозвать после
   опыта), перезапуск worfy. Узнать, с каким `GH_TOKEN` идёт gh в PR inbox, PR badges, Health check (`gh-auth`), Codex
   и `ipc/projects.ts`: из rc-файла, из `process.env` или никак. Тот же опыт — без rc-файла, где он экспортирует
   переменную. Значение токена не печатать: сравнивать только признак «задан» и login из `gh api user --jq .login`.
2. На ПК владельца: `setx GH_TOKEN <тестовый токен>`, перезапуск worfy, тот же список.
3. Таблица вызовов `ghRunner` и `runGh` (`src/main/first-run/checks.ts:359`): с каким `env` каждый идёт, видит ли он
   переменную окружения системы.
4. Проверить, что `gh auth token -u <login>` печатает токен keyring, а не значение `GH_TOKEN`, когда переменная задана
   (macOS и Windows).
5. Ответы GitHub: `gh api -i repos/<owner>/<repo>` с отозванным токеном (401) и на repo без доступа (404); что gh
   печатает в stdout и stderr, какой exit code. Вывод `gh auth status` с записью `(GH_TOKEN)` — с рабочим и с
   неверным токеном.
6. Итог — `.scratch/worfy-auth-check/spike.md`, раздел «Локальный путь токена» (раздел SAML пишет Ticket 02 в свой файл
   `spike-saml.md`). Fixtures — `.scratch/worfy-auth-check/fixtures/local/`: вывод `gh auth status` (с `(GH_TOKEN)` и
   без), ответы 401 и 404 с заголовками `gh api -i`. Scrub: без токенов, без login и организаций владельца — их место
   занимают `alice`, `acme`, `acme/web`.
7. Тестовый токен отозван после опыта, переменная снята (`launchctl unsetenv GH_TOKEN`, на ПК — удалить в registry).

## Готово, когда

- [ ] `spike.md`, раздел «Локальный путь токена»: как `GH_TOKEN` доходит до gh worfy на macOS, с выводом запусков.
- [ ] Тот же раздел, часть Windows: как доходит `setx GH_TOKEN`, с выводом запусков на ПК.
- [ ] Таблица вызовов `ghRunner` и `runGh`: окружение каждого и видна ли переменная системы.
- [ ] Ответ: `gh auth token -u` берёт keyring при заданном `GH_TOKEN` — да или нет, на обеих Machine.
- [ ] Fixtures 401, 404 и `gh auth status` с `(GH_TOKEN)` лежат в `fixtures/local/`; `node scripts/check-personal.mjs` —
      exit 0 на них.
- [ ] Тестовые токены отозваны, переменные сняты (строка в «Итог»).
- [ ] `ci-ok` зелёный на head PR.

## Где в коде

Только читать: `src/main/github/prs.ts`, `src/main/agent/env.ts`, `src/main/ipc/pr-inbox.ts`, `src/main/ipc/gate-queue.ts`,
`src/main/ipc/projects.ts`, `src/main/ipc/checks.ts`, `src/main/first-run/checks.ts`, `src/main/vendors/codex/session.ts`,
`src/main/github/auth-text.ts`.

Писать: `.scratch/worfy-auth-check/spike.md`, `.scratch/worfy-auth-check/fixtures/local/`.

## Вне скоупа

- SAML SSO, `X-GitHub-SSO`, `partial-results` — Ticket 02.
- Любая правка кода — Ticket-ы 03 и 05.
