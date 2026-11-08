# 05 — Чистка `test/` и fixture-ов: вымышленные имена

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Что нашла разведка 2026-11-08»; «Как работает» → «Чистка»; «Риски», п. 1; Q6

Не платформенный: меняются только данные test-ов, не код приложения и не скрипты Harness. Глубина ревью — `medium`.

Test-ы и fixture переноса старого Harness — не здесь, а в Ticket-е 04 (`test/contract/harness-migrate*.ts`,
`harness-plugin.test.ts`, `e3-owner-check.test.ts`, `test/e2e/harness-migrate.spec.ts`,
`test/fixtures/claude-home-legacy/**`). Test guard-а `test/unit/check-personal.test.ts` — Ticket-ов 01 и 06.

## Что происходит

- `test/` и fixture-ы — основная масса: домашний путь с именем пользователя ≈ 1540 строк, имена других проектов
  владельца ≈ 343, имя владельца в прозе ≈ 55 (часть из них — в файлах Ticket-а 04).
- Адрес tailnet и адрес Tailscale — `test/unit/link-magicdns.test.ts:191-232`, `test/contract/link-reconnect.test.ts:256`.
- Аккаунт репозитория в test-ах кода обновления — работает как адрес репозитория, остаётся (Q1).
- Часть fixture-ов уже пишет `/Users/someone` — его `harness/lib/privacy.cjs` считает stand-in-ом.

## Что делаем

1. Отчёт guard-а по `test/` без файлов Ticket-ов 01 и 04 — список работы.
2. Домашний путь с именем пользователя → `/Users/someone/…` (macOS), то же имя для Linux и Windows путей.
3. Имена других проектов → один вымышленный проект (и второй, если test-у нужно два).
4. Имя хоста → `someones-mac`; адрес tailnet → хосты вида `<host>.example.ts.net`; адрес Tailscale → адрес quad-100
   DNS-сервера самого Tailscale или другой адрес из списка stand-in-ов guard-а Ticket-а 01 (для test-ов,
   которым нужно несколько адресов). Список guard-а этот Ticket не правит.
5. Имя владельца в прозе test-ов и fixture-ов → «owner» (код и комментарии — английские).
6. Строка в test-е и в fixture-е меняются вместе: test сверяет ту же вымышленную строку. Test-ы, которые проверяют
   разбор пути, имени хоста или MagicDNS, сохраняют форму значения (длина, точки, регистр), меняется только имя.

## Готово, когда

- [ ] Отчёт guard-а по файлам этого Ticket-а — ноль находок, кроме аккаунта репозитория в коде обновления.
- [ ] Ни один test не удалён и не пропущен ради чистки; число test-ов в `pnpm test` то же, что до правки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Все unit и contract test-ы, чьи файлы или fixture-ы правятся; полный `pnpm test` и `pnpm test:e2e`.

## Где в коде

- `test/**`, кроме файлов Ticket-а 04 и `test/unit/check-personal.test.ts`
