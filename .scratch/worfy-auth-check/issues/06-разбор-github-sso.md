# 06 — GitHub SSO: разбор `X-GitHub-SSO` и `partial-results`, ссылка авторизации в строке Project-а

Type: task
Status: open
Blocked by: 02, 05
Source: [spec.md](../spec.md), «Ticket-ы», 6; «Проблема», пункт «PR inbox»; «Починка», строка SSO; «Решения по
реализации», 3; «Решения по test-ам»; «Риски», «Гипотеза о GraphQL не подтвердится» и «Токен в выводе»; «Волны»,
строка «когда придёт ответ»; «Решения владельца», Q6;
[critic 2026-11-18](../../../docs/product/critic/worfy-auth-check-2026-11-18.md), возражение 1 и «Alternative»

Кто: агент.

Не платформенный Ticket (разбор ответа GitHub, без веток по платформе). Глубина ревью — `medium`.

Ждёт ответа тестера через Ticket 02; без него не стартует. Не идёт в одной Wave с 05: оба правят
`src/main/github/auth-diagnosis.ts` и `src/main/first-run/checks.ts`.

## Что происходит

- SSO и SAML не распознаются нигде в `src/`. PR inbox ищет одним `gh api graphql` (`src/main/github/inbox.ts:86-89`);
  ошибка gh попадает в `state.error` (`inbox.ts:382`, `:552`).
- Ticket 05 дал `auth-diagnosis.ts` (источник токена, 200, 401, 404, `unknown`) и строку GitHub access Project-а
  (`gh api -i repos/<owner>/<repo>`). 403 он читает как «нет доступа» без ссылки.
- Ticket 02 дал `spike-saml.md`: что GitHub отвечает на REST и на поиск для организации с SAML, что печатает gh, и
  способ разбора — заголовок через `gh api -i` или текст gh; fixtures — `.scratch/worfy-auth-check/fixtures/saml/`.
- Ticket 07 берёт текст причины PR inbox из строки GitHub access: SSO-текст появится в PR inbox сам, когда его даст
  этот Ticket.

## Что делаем

1. `src/main/github/auth-diagnosis.ts`: способом из `spike-saml.md`:
   - `X-GitHub-SSO: required; url=…` → SSO, с организацией и ссылкой авторизации;
   - `X-GitHub-SSO: partial-results; organizations=…` → часть организаций скрыта (поиск PR inbox);
   - без заголовка и без текста gh о SAML — разбор Ticket-а 05 без изменений.
2. Строка GitHub access (`src/main/first-run/checks.ts`): SSO — critical, needs-user: «GitHub refused: the token from
   <источник> is not authorized for <org>», шаг «Authorize the token for <org>», кнопка Open link (ссылка из
   `X-GitHub-SSO`, браузер системы). Уровень — из `src/shared/health/severity.ts` без правки.
3. `partial-results` в поиске PR inbox: если `spike-saml.md` подтвердил заголовок у поиска — сообщение
   `reportFailure` строки Project-а с тем же текстом; если не подтвердил — только REST-проверка строки (spec, «Риски»).
4. Ссылка SSO — не секрет, но в log не пишется (spec, «Риски», «Токен в выводе»).
5. Английская страница `docs/features/gate-and-github.md`: SSO, ссылка, `partial-results`. Перевод — Ticket 09
   (SSO-часть дописывается после этого Ticket-а).

## Готово, когда

- [ ] Unit test (`test/unit/auth-diagnosis.test.ts`) на fixtures Ticket-а 02, скопированных в `test/fixtures/gh-auth/`
      (scrub: без токенов, организаций и login тестера): `required; url=…` → SSO со ссылкой; `partial-results;
      organizations=…` → часть скрыта; ответ без заголовка — прежний разбор.
- [ ] Contract test (`test/contract/health-github-access.test.ts`) на stand-in gh (`WORFY_GH`): SSO 403 → needs-user со
      ссылкой и кнопкой Open link; `partial-results` → строка по решению пункта 3.
- [ ] e2e test (`test/e2e/pr-inbox.spec.ts`), если Ticket 07 уже влит: его test отказа PR inbox с ответом SSO 403
      stand-in gh — иконка красная, щелчок открывает Settings → Health со строкой Project-а и ссылкой. Без реальной
      сети.
- [ ] Test, что ни одна строка, log и текст ошибки не содержат значение токена, а log — ссылку SSO: stand-in gh
      печатает известный токен, test ищет его во всём выводе.
- [ ] Все unit и contract test-ы модуля зелёные: `test/unit/auth-diagnosis.test.ts`, `test/unit/gh-auth-text.test.ts`,
      `test/contract/health-github-access.test.ts`, `test/contract/first-run-checks.test.ts`,
      `test/contract/github-prs.test.ts`, `test/contract/pr-inbox.test.ts`.
- [ ] Английская страница `gate-and-github.md` описывает SSO.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/github/auth-diagnosis.ts`
- `src/main/first-run/checks.ts` (строка GitHub access)
- `src/main/github/inbox.ts` (только если пункт 3 берёт `partial-results` поиска)
- `test/fixtures/gh-auth/`, `test/fixtures/gh/gh-stub.mjs` (заголовок `X-GitHub-SSO`)
- `test/unit/auth-diagnosis.test.ts`, `test/contract/health-github-access.test.ts`
- `docs/features/gate-and-github.md`

Только читать: `.scratch/worfy-auth-check/spike-saml.md`, `src/shared/health/severity.ts`.

## Вне скоупа

- Источник токена, 401, 404, «Use <login>» — Ticket 05.
- Ссылка «Open Health check» в PR inbox — Ticket 07.
