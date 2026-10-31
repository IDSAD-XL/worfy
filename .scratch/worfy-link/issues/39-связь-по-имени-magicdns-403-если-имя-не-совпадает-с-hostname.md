# 39 — Связь по имени MagicDNS даёт 403, когда имя машины в tailnet не совпадает с hostname; отказ не пишется в журнал

Type: bug
Status: claimed 2026-10-31T03:15Z
Branch: worfy-link/39
Blocked by: —
Source: приёмка link 31 с владельцем 2026-10-31, шаг 2: «Link a machine» с ПК по адресу
`alexeys-macbook-pro.taila00ba6.ts.net:57769` — Mac ответил 403; по адресу Tailscale `100.71.20.55:57769` (нашёл
автопоиск) связь прошла. В `link.log` Mac строки об отказе нет. Ticket заведён Orchestrator-ом; держит приёмку 31.

## Что происходит

- Проверка Host сервера связи (`src/main/link/server.ts:52` → `isAllowedHost`, `src/main/link/checks.ts:229`;
  `isAllowedHostName`, `checks.ts:195`) принимает имя MagicDNS, только если его первая метка равна первой метке
  `os.hostname()` (сокращение в коде, `checks.ts:191-194`, с пометкой «переделать»).
- На Mac владельца `os.hostname()` — `Alexeys-MacBook-Pro-164.local`, а имя в tailnet — `alexeys-macbook-pro`
  (`tailscale status --json`, `Self.DNSName` = `alexeys-macbook-pro.taila00ba6.ts.net.`). Метки разные — 403.
  macOS добавляет такой суффикс (`-164`) сам, когда имя в сети уже занято; Tailscale берёт своё имя иначе.
- `refuse()` (`server.ts:67-73`) пишет 403 в сокет и ничего не печатает: ни причины, ни Host, ни адреса peer-а.
  ADR-0070, п. 5 (`docs/adr/0070-*.md:83`) требует, чтобы проверка Host знала имена MagicDNS этой машины.

## Что делаем

1. Имя MagicDNS этой машины берётся из самого Tailscale: `Self.DNSName` из `tailscale status --json` (Mac — CLI внутри
   `Tailscale.app`, Windows — `tailscale.exe`; найти так же, как уже находит `src/main/link/tailscale.ts`), с кэшем и
   обновлением при смене сети. Нет CLI или ошибка — прежнее правило по `os.hostname()`. Защита не ослабляется:
   принимается только точное имя этой машины, а не любое `*.ts.net`.
2. Каждый отказ `checkUpgrade` пишет строку `[link] refused a connection from <peer>: <причина> (Host <host>)` в журнал
   (`link.log`), без секретов.

## Готово, когда

- [ ] Contract test: hostname машины не совпадает с первой меткой `DNSName` (stub `tailscale` в PATH или подменённая
      функция чтения статуса) — Host `<DNSName>:<port>` принимается; чужое имя `*.ts.net` — 403. Сначала красный.
- [ ] Test: Tailscale не установлен / статус не читается — прежнее правило по hostname (существующие test-ы зелёные).
- [ ] Test: отказ по Host, по Origin и по peer пишет строку `[link] refused …` с причиной.
- [ ] Пределы test-ов не подняты; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; Windows-job CI зелёный.
- [ ] (вручную, с владельцем, вместе с link 31) связь с ПК по `alexeys-macbook-pro.taila00ba6.ts.net:57769` проходит.

## Где в коде

- `src/main/link/checks.ts`, `src/main/link/server.ts`, `src/main/link/tailscale.ts`, `src/main/link/service.ts` (подключение
  чтения имени к серверу связи: кэш на сеть и чтение `tailscale` только в приложении, не в test-ах)
- `test/contract/link-server.test.ts`, `test/contract/link-by-name.test.ts`, `test/unit/link-magicdns.test.ts`

## Итог

Заполняется при закрытии.
