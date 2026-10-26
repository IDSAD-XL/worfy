# 27 — Связь через Tailscale: настройка в Settings и адреса Tailscale только на интерфейсе Tailscale

Type: task
Status: done 2026-10-26T22:21Z
PR: #840
Branch: worfy-link/27
Blocked by: —
Source: решения владельца 2026-10-18, Q16, Q23, Q24 ([ADR-0070](../../../docs/adr/0070-worfy-link-outside-the-lan-through-an-overlay-network.md), пункты 2–4). Код начинается после текущей очереди Epic-а `worfy-windows` (Q21, HANDOFF.md, «Дальше»)

## Что происходит

- Machine — компьютер с worfy; Linked machine — другой компьютер с worfy, связанный с ним по коду.
- Сервер связи сбрасывает соединение с адреса не из локальной сети на TCP, до TLS handshake
  (`src/main/link/server.ts:118-125`), и ещё раз на upgrade до WebSocket (`server.ts:48`, `checkUpgrade`).
  Правило одно — `isLocalNetworkAddress` (`src/main/link/checks.ts:46-63`).
- Tailscale даёт машине адрес IPv4 из 100.64.0.0/10 и IPv6 из `fd7a:115c:a1e0::/48`. Первый сегодня
  отклоняется. Второй принимается: он лежит внутри `fc00::/7`, который правило считает локальным.
- 100.64.0.0/10 — тот же диапазон, что провайдеры интернета используют для carrier-grade NAT. Сосед у
  того же провайдера может прийти с адреса из него. Поэтому одного диапазона мало: нужно, чтобы
  соединение пришло на локальный адрес интерфейса Tailscale этой машины (`socket.localAddress`).
- Настройки связи живут в `link/settings.json` папки данных (`src/main/link/settings.ts`), секция
  Settings — `src/renderer/settings/MachinesSection.tsx`. Переключателя для Tailscale нет.

## Что делаем

1. В Settings, секция Machines, — переключатель «Связь через Tailscale» (название — владельца; текст в
   английском интерфейсе предлагает исполнитель). По умолчанию выключен — и в свежей папке данных, и в
   файле настроек, записанном до этого Ticket-а.
2. Правило соседа становится функцией от настройки и от соединения: адрес соседа и локальный адрес,
   на который пришло соединение.
   - Настройка выключена: принимаются только адреса локальной сети, как сегодня, кроме
     `fd7a:115c:a1e0::/48` — он больше не проходит как `fc00::/7`.
   - Настройка включена: дополнительно принимаются 100.64.0.0/10 и `fd7a:115c:a1e0::/48`, но только если
     локальный адрес соединения — адрес интерфейса этой машины из того же диапазона (интерфейс
     Tailscale: `utun*` на macOS, адаптер «Tailscale» на Windows; узнаётся по адресу из
     `os.networkInterfaces()`, а не по имени).
3. Правило применяется и на TCP (`connection`), и на upgrade (`checkUpgrade`). Оба места читают
   настройку при каждом соединении: переключатель действует без перезапуска.
4. Выключение настройки закрывает открытые соединения с адресов Tailscale.

## Готово, когда

- [ ] Unit test правила: 100.64.0.1 с локальным адресом из 100.64.0.0/10 — принят при включённой
      настройке и отклонён при выключенной; 100.64.0.1 с локальным адресом 192.168.x — отклонён всегда;
      то же для `fd7a:115c:a1e0::1`; `fd00::1` (другой ULA) — принят, как сегодня; 8.8.8.8 — отклонён
      всегда.
- [ ] Contract test сервера (стенд `test/contract/link-bench.ts` с подменённым списком интерфейсов):
      соединение с адреса Tailscale при выключенной настройке сброшено до TLS handshake.
- [ ] Test настроек: свежая папка данных и файл прежней версии — настройка выключена.
- [ ] Выключение настройки закрывает открытое соединение с адреса Tailscale (contract test).
- [ ] e2e: переключатель виден в Settings, по умолчанию выключен.

## Где в коде

- `src/main/link/checks.ts` — `isLocalNetworkAddress` и новое правило соседа.
- `src/main/link/server.ts` — `isAllowedPeer` (`:91`, `:118`), `connection` (`:123-125`), `checkUpgrade` (`:47-48`).
- `src/main/link/settings.ts`, `src/shared/ipc/link.ts`, `src/renderer/settings/MachinesSection.tsx`.
- `src/main/link/service.ts` — передача настройки и списка интерфейсов в сервер.
- `test/unit/` (test правила), `test/contract/link-server.test.ts`, `test/contract/link-bench.ts`.

## Риски

- Адрес IPv6 Tailscale, который сегодня проходит, без настройки проходить перестанет. Связь, уже
  работающая по такому адресу, оборвётся до включения настройки. Проверить при claim, есть ли такие
  связи у владельца.
- На Windows адаптер Tailscale может получить адрес позже запуска worfy: список интерфейсов читается
  на каждом соединении, как в `allowedHostNames`.

## Итог

- Правило соседа — `isAllowedPeer({ remote, local }, { tailscale, interfaces })` в
  `src/main/link/checks.ts`. Адрес соседа из 100.64.0.0/10 или `fd7a:115c:a1e0::/48` проходит, только
  если настройка включена, локальный адрес соединения лежит в том же диапазоне (IPv4 к IPv4, IPv6 к
  IPv6) и он есть у интерфейса этой машины в `os.networkInterfaces()`. Имя интерфейса не смотрится,
  ветвления по платформе нет. Любой другой сосед — `isLocalNetworkAddress`, как раньше; адреса
  Tailscale через `fc00::/7` больше не проходят. Сама `isLocalNetworkAddress` не менялась: её
  использует ещё Bonjour (`discovery.ts`).
- Сервер (`src/main/link/server.ts`) спрашивает правило на TCP (`connection`, до TLS handshake) и
  ещё раз на upgrade (`checkUpgrade`). Сервис (`src/main/link/service.ts`) отдаёт серверу правило,
  которое читает настройку и список интерфейсов на каждом соединении: переключатель действует без
  перезапуска, а адаптер Tailscale, получивший адрес после запуска worfy, виден сразу.
- Выключение настройки обрывает соединения и попытки pairing с адресом Tailscale в обе стороны
  (`closeTailscalePeers`): входящие и те, что эта машина открыла сама.
- Круг доработки (ревью, находка med): ADR-0070 требует настройку на обеих Machine, поэтому при
  выключенной настройке эта машина и сама не связывается с адресом Tailscale. `openLinkSocket`
  (`src/main/link/client.ts`, вне «Где в коде», с разрешения оркестратора) сначала открывает TCP и
  спрашивает `allowServer` до первого байта TLS; адрес, в который разрешилось имя (MagicDNS), тоже
  проверяется. Отказ — `LinkConnectError` `refused` с текстом «… is at the Tailscale address …, and
  "Link through Tailscale" is off on this Machine: turn it on in Settings → Machines». Так отказывают
  `connect` (и переподключение `connections.ts` по запомненному адресу) и `pair`. Сразу после open
  `service.ts` проверяет ещё раз: настройку могли выключить во время TLS handshake.
- Риск «связь по `fd7a` оборвётся» (раздел «Риски»): у владельца таких связей не ожидается — Bonjour
  предпочитает IPv4, а Tailscale ещё не установлен.
- Настройка — поле `tailscale` в `link/settings.json` (`src/main/link/settings.ts`), версия файла
  та же, 2. Свежая папка данных, файл версии 1, файл версии 2 без поля и нечитаемый файл — выключено.
- Settings → Machines: переключатель «Link through Tailscale» с подсказкой «Lets a Linked machine
  reach this computer at its Tailscale address. Turn it on on both computers. Off closes the links
  that came through Tailscale». Не зависит от «Linked machines can work with my Projects»: он решает,
  кто вообще доходит до сервера, pairing тоже. Канал IPC — `link.setTailscale`, поле состояния —
  `tailscale`.
- Вне «Где в коде», с разрешения оркестратора: `src/main/ipc/link.ts` (обработчик канала и поле
  состояния), `src/renderer/machines/useMachines.ts` (`setTailscale`),
  `test/contract/link-connections.test.ts` и `test/e2e/linked-machines.spec.ts` (форма файла
  настроек с новым полем; e2e переключателя), fixture-ы `LinkState` в unit test-ах.
- Contract test-ы идут на 127.0.0.1: стенд `link-bench.ts` получил `peerAddresses` — сервер читает
  адреса сокета как заданные (опция `addressesOf` сервиса и сервера), и у машин стенда есть интерфейс
  с локальным адресом.
- Платформенный ли PR (ADR-0056, пункт 2): нет. Код не ветвится по платформе: интерфейс Tailscale
  узнаётся по адресу, одинаково на macOS (`utun*`) и Windows (адаптер «Tailscale»).

### Ревью и merge (2026-10-26)

PR #840: ревью уровня low, два круга (первый — REJECTED, находка med про исходящую связь по адресу
Tailscale при выключенной настройке; второй — VERIFIED). gate full зелёный перед merge, merge
`49a573d3`. Batch CI на этом коммите упал на регрессии PR #826 (`wave-gate-heartbeat.test.sh` на
Linux); её исправил PR #846, batch CI на `680ab775` зелёный.

Долги ревью (не блокируют):
- Consider: адрес 100.64.0.0/10 прямо на интерфейсе, который не Tailscale (CGNAT у провайдера),
  проходит правило соседа (`src/main/link/checks.ts:124`).
- Consider: по имени хоста теперь уходит SNI (`src/main/link/client.ts:105`); test на это добавил
  Ticket 29.
- Noted: в F-SPEC.md нет строки про настройку «Link through Tailscale» (`F-SPEC.md:164`).
