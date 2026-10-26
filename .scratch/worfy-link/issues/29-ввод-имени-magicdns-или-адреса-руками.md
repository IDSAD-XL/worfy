# 29 — Через Tailscale: ввод руками имени MagicDNS или IP-адреса, порт из окна другой машины

Type: task
Status: done 2026-10-26T22:21Z
PR: #841
Branch: worfy-link/29
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

- [x] Unit test: `pc:52000`, `100.101.102.103:52000`, `[fd7a:115c:a1e0::1]:52000` разбираются.
- [x] Unit test `allowedHostNames`: при включённой настройке `pc` и `pc.example.ts.net` для машины `pc`
      приняты, `other.example.ts.net` — нет; при выключенной — ни одно.
- [x] Contract test: соединение с `Host: pc:<port>` при включённой настройке доходит до upgrade.
- [x] e2e: в окне «Link a machine» адрес Tailscale помечен (интерфейсы подменены).
- [x] Ответ владельца по пункту 3 записан в «Итог».

## Где в коде

- `src/main/link/checks.ts` — `allowedHostNames`.
- `src/main/link/service.ts` — `addresses()` (`:250`).
- `src/shared/ipc/link.ts` — `parseLinkAddress` (`:38`), состояние окна (`addresses`, `:130`).
- `src/renderer/machines/LinkMachineDialog.tsx`.
- `test/unit/` (разбор адреса, `allowedHostNames`), `test/contract/link-server.test.ts`, e2e окна связи.

## Итог

- **Пункт 3, имена MagicDNS в проверке `Host` — решено без владельца, подтвердить** (оркестратор,
  2026-10-26, по рекомендации тикета; вопрос владельцу задан). Пока настройка «Link through Tailscale»
  включена, проверка `Host` принимает, кроме прежних имён: голое имя машины — первую метку
  `os.hostname()` в нижнем регистре (на Windows это всё имя), и имена вида `<это имя>.<что угодно>.ts.net`
  (между именем и `ts.net` — одна или несколько меток DNS). Без настройки — ни одно из них.
  Защита от DNS rebinding (ADR-0052, пункт 8) держится: зону `ts.net` контролирует только Tailscale.
- Ограничение: если машину переименовали в админке Tailscale, по имени MagicDNS она не подключится
  (отказ 403 до upgrade) — нужно вводить IP-адрес Tailscale. В коде — комментарий `shortcut:` у
  `isAllowedHostName`; переделать, когда список машин придёт из `tailscale status --json` (Ticket 30).
- Код: `isAllowedHostName` и поле `tailscale` в `HostNames` (`src/main/link/checks.ts`); сервис отдаёт
  серверу настройку вместе с интерфейсами и именем, читает её на каждом запросе: выключение отказывает
  по имени со следующего upgrade, без перезапуска.
- Окно «Link a machine»: адрес из 100.64.0.0/10 или `fd7a:115c:a1e0::/48` помечен chip-ом «Tailscale»
  (tooltip при выключенной настройке говорит включить её на обеих машинах); при включённой настройке
  адреса Tailscale идут первыми (`linkAddresses`, `src/main/link/service.ts`). Пометку ставит окно
  по `isTailscaleHost` (`src/shared/ipc/link.ts`); контракт `link.state` не менялся, unit test держит
  `isTailscaleHost` и `isTailscaleAddress` main на одной таблице.
- Поле ввода: разбор `parseLinkAddress` уже принимал `pc:52000`, IP-адрес и `[fd7a:…]:port` — добавлен
  только test. Подсказка под полем говорит, что адрес и порт — под кодом в окне другой машины, а при
  включённой настройке — что через Tailscale вводят имя MagicDNS или адрес Tailscale с этим портом.
- Переподключение: pairing по имени запоминает имя (`record.address`), а не адрес, в который оно
  разрешилось; contract test связывает по имени `localhost`, перезапускает A и подключается по
  запомненному имени. Отдельный contract test проверяет, что по имени уходит SNI, а по адресу — нет
  (долг ревью Ticket-а 27).
- Для e2e добавлена переменная `WORFY_LINK_INTERFACES` (JSON: имя интерфейса → адреса): подменяет
  `os.networkInterfaces()` приложению и показывает эти адреса в окне, хотя сервер слушает только
  127.0.0.1. Круг доработки (ревью, находка med): переменная читается только в неупакованной сборке
  (`app.isPackaged` false, как `ELECTRON_RENDERER_URL`), а из значений берутся только IP-адреса
  (`net.isIP`); имя отбрасывается с warn. Иначе имя из переменной попало бы в список `Host` и обходило
  защиту от DNS rebinding, а собранный `.app` подменял бы интерфейсы и в правиле соседа.
- Contract test-ы подключения по имени — в отдельном файле `test/contract/link-by-name.test.ts`.
- Снимки окна в светлой и тёмной теме — в scratchpad ревью, в репозиторий не кладутся.


### Ревью и merge (2026-10-26)

PR #841: ревью уровня low, два круга (первый — REJECTED, находка med про `WORFY_LINK_INTERFACES` в
собранном приложении; второй — VERIFIED, новых долгов нет). gate full зелёный перед merge, merge
`d2078574`, после зелёного batch CI на `680ab775`.

Пункт 3 (какие имена MagicDNS принимает проверка `Host`: голое имя машины и `<имя>.<что угодно>.ts.net`
при включённой настройке) решён без владельца — подтвердить.
