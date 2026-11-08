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
  - evidence: test-run pass · `pnpm test` exit 0, 16635 tests, no test declaration added or removed, no skip added · mac - · e195f9b9891e1ad886ea5105c41829eeda61e0f9
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · e195f9b9891e1ad886ea5105c41829eeda61e0f9
  - evidence: gate pass · `gate fast` exit 0 · mac - · e195f9b9891e1ad886ea5105c41829eeda61e0f9
  - evidence: test-run pass · `pnpm test:e2e` of the touched specs exit 0 (limits-vendors rerun after the name fix) · mac - · e195f9b9891e1ad886ea5105c41829eeda61e0f9

## Тесты

- Все unit и contract test-ы, чьи файлы или fixture-ы правятся; полный `pnpm test` и `pnpm test:e2e`.

## Где в коде

- `test/**`, кроме файлов Ticket-а 04 и `test/unit/check-personal.test.ts`

## Итог

Ветка `worfy-scrub/05`, commit правки `e195f9b9891e1ad886ea5105c41829eeda61e0f9`.

### Отчёт guard-а по файлам Ticket-а

`node scripts/check-personal.mjs --report --list` (exit 0), строки под `test/` без файлов Ticket-ов 01 и 04:

- до правки — 1559 находок в 169 файлах: home-path 886, deny-word 437, host 116, tailscale-ip 75, email 23, token 22;
- после — 33 находки в 7 файлах: home-path 22, host 11.

Все 33 оставшиеся — подстановки, которые пишет `scripts/codex-capture.mjs` (строка 721 и имя хоста записи) вместо
домашней папки и хоста: записи `test/fixtures/codex-messages/*.jsonl`, их `README.md` и проверки
`test/contract/codex-compat.test.ts`, которые сверяют вывод скрипта. Заменить их можно только вместе со скриптом, а
он вне «Где в коде» этого Ticket-а. Ревью, раунд 1: Orchestrator принял эти 33 находки как остаток, они переходят в
Ticket 06 вместе со скриптом.

Поиск подстрокой по открытому списку (`git grep -i -F` по каждой записи, те же файлы), находки по номеру записи
0–9: до — 63, 0, 0, 188, 164, 4, 0, 0, 0, 0; после — все 0.

### Что заменено

- Домашняя папка с именем пользователя → `/Users/someone` (`C:\Users\someone`, `/home/someone`) с тем же регистром
  букв; где test-у нужен второй пользователь — `user` или `you`; короткое имя 8.3 — `RUNNER~1` при папке
  `runneradmin`. Форма пути сохранена: пробел, кавычка, `$`, кириллица и эмодзи остались в пути, в следующей папке.
- Другие проекты владельца → вымышленные `atalaya` и `auberge` (порядок сортировки как у прежних имён); в
  `test/e2e/limits-vendors.spec.ts` — `caution`, той же ширины в строке, что имя макета F.
- Хосты → `someones-mac`, `someones-pc` и другие stand-in-ы хостов из `scripts/check-personal.mjs`, `<host>.example.ts.net`;
  адреса Tailscale → `100.64.0.x`.
- Значения, которые test должен видеть в настоящей форме (поддельные токены, имена `*.local`, границы диапазона
  100.64.0.0/10, адреса с `@` в URL), собраны из частей в коде test-а, как уже сделано в
  `test/unit/terminal-ai-redact.test.ts`: значение при запуске то же, guard его в тексте не видит.
- Хэши от путей пересчитаны: тег gate в `test/unit/gate-state.test.ts` (`printf %s <путь> | shasum`), id Project-а
  в `test/unit/project-store.test.ts` и `test/unit/permission-card.test.tsx`.

Новых категорий личных строк не найдено.

### Проверки

- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; `Tests 16512 passed | 123 skipped (16635)`. Diff не
  добавляет и не убирает ни одного объявления test-а (15 строк с `it(`/`test(` изменены на месте), `.skip`
  и `.only` не добавлены.
- `gate fast` — exit 0, `[gate] green (fast)`.
- `pnpm test:e2e` по тронутым spec-ам (`browser-mcp`, `done-stack`, `epic-frame`, `limits-vendors`,
  `linked-tailscale`, `packaged`, `projects`, `silent-project`, `snapping`, `toast-placement`) — 45 passed, 1 skipped,
  1 failed (`limits-vendors`: заголовок шире места); после замены имени `limits-vendors.spec.ts` — exit 0, 2 passed.

### Ревью, раунд 1

- `test/unit/link-tailscale.test.ts`: test «keeps a peer whose address only looks like a remembered one» снова
  проверяет адрес, который начинается с запомненного. У `pc` в `test/fixtures/tailscale/status.json` теперь
  stand-in-адрес Tailscale, который начинается с запомненного stand-in-адреса; ожидания с адресом `pc` поправлены. Mutant `known.has(key)` →
  `[...known].some((k) => key.startsWith(k))` в `src/main/link/tailscale.ts:93` — красный (exit 1,
  `Tests 1 failed | 27 passed (28)`), правка `src` откачена.
- `test/contract/shell.test.ts:251`: путь `/wf/../Users/someone/../someone/wf` снова ведёт в домашнюю папку.
- `test/unit/gate-state.test.ts:270`: комментарий — по новому пути.
- Тронутые test-ы — exit 0, `Tests 235 passed (235)`.
