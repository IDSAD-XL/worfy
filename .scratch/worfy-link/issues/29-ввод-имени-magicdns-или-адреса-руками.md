# 29 — Через Tailscale: ввод руками имени MagicDNS или IP-адреса, порт из окна другой машины

Type: task
Status: open
Blocked by: 27
Source: решения владельца 2026-10-18, Q22 ([ADR-0070](../../../docs/adr/0070-worfy-link-outside-the-lan-through-an-overlay-network.md), пункт 5). Код начинается после текущей очереди Epic-а `worfy-windows` (Q21)

## Что происходит

- Machine-ы находят друг друга через Bonjour (`_worfy._tcp`, `src/main/link/discovery.ts`). Bonjour не
  проходит через overlay-сеть (Tailscale), поэтому через неё машину находят руками.
- Ввод адреса руками уже есть (Ticket 02): поле `host:port` в «Link a machine», разбор —
  `parseLinkAddress` (`src/shared/ipc/link.ts:38`). Окно на Machine B показывает её адреса с портом
  (`service.addresses()`, `src/main/link/service.ts:250`): все не внутренние адреса, среди них и адрес
  Tailscale. Какой из них Tailscale, окно не говорит.
- Владелец решил (Q22): сначала — ввод руками имени MagicDNS (DNS-имени машины внутри tailnet, например
  `pc`) или IP-адреса; порт — из окна «Link a machine» другой машины. После pairing адрес запоминается
  (запись связи хранит его уже сейчас, `record.address`).
- Проверка `Host` (`allowedHostNames`, `src/main/link/checks.ts`) знает адреса интерфейсов, `localhost`
  и имя в `.local`. По IP-адресу Tailscale соединение пройдёт. По имени `pc` или
  `pc.<tailnet>.ts.net` — отказ до upgrade: таких имён в списке нет. На Windows `os.hostname()` —
  голое имя без `.local`, и его в списке тоже нет.

## Что делаем

1. Окно «Link a machine» на B помечает адрес Tailscale (из 100.64.0.0/10 или `fd7a:115c:a1e0::/48` на
   интерфейсе этой машины) и показывает его первым, когда настройка «Связь через Tailscale» включена.
2. Поле ввода принимает имя MagicDNS с портом (`pc:52000`) и IP-адрес Tailscale. Подсказка под полем
   говорит, где взять порт.
3. Проверка `Host` принимает имена MagicDNS этой машины, когда настройка включена. Развилка — к
   владельцу при claim: как их узнать без Tailscale CLI. Рекомендация: голое имя машины (первая метка
   `os.hostname()`, в нижнем регистре) и имена вида `<это имя>.<tailnet>.ts.net`. Защита от DNS
   rebinding (ADR-0052, пункт 8) держится: чужой сайт не управляет зоной `ts.net`.
4. Переподключение после pairing идёт по запомненному адресу, как сейчас; через Tailscale адрес и имя не
   меняются.

## Готово, когда

- [ ] Unit test: `pc:52000`, `100.101.102.103:52000`, `[fd7a:115c:a1e0::1]:52000` разбираются.
- [ ] Unit test `allowedHostNames`: при включённой настройке `pc` и `pc.example.ts.net` для машины `pc`
      приняты, `other.example.ts.net` — нет; при выключенной — ни одно.
- [ ] Contract test: соединение с `Host: pc:<port>` при включённой настройке доходит до upgrade.
- [ ] e2e: в окне «Link a machine» адрес Tailscale помечен (интерфейсы подменены).
- [ ] Ответ владельца по пункту 3 записан в «Итог».

## Где в коде

- `src/main/link/checks.ts` — `allowedHostNames`.
- `src/main/link/service.ts` — `addresses()` (`:250`).
- `src/shared/ipc/link.ts` — `parseLinkAddress` (`:38`), состояние окна (`addresses`, `:130`).
- `src/renderer/machines/LinkMachineDialog.tsx`.
- `test/unit/` (разбор адреса, `allowedHostNames`), `test/contract/link-server.test.ts`, e2e окна связи.
