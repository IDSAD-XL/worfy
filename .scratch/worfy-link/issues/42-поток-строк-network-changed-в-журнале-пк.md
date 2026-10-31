# 42 — Поток строк «the network of this Machine changed» в журнале ПК

Type: bug
Status: open
Blocked by: —
Source: журнал main-процесса worfy на ПК (Windows) во время приёмки link 31, 2026-10-31: строка
`[link] the network of this Machine changed: …` повторяется много раз подряд. Разбор кода — scout Orchestrator-а.
Ticket заведён Orchestrator-ом без владельца (ночь 2026-10-31, полная автономия).

## Что происходит

- `watchNetwork` (`src/main/link/connections.ts:275-300`) каждые 5 s читает `os.networkInterfaces()` и сравнивает
  подпись `networkSignature` (`connections.ts:264-269`): все не-`internal` адреса вида `"<имя> <адрес>"`, отсортированы.
- В подпись попадают IPv6 (временные адреса Windows меняются по таймеру), `fe80::`, `169.254.*`, виртуальные адаптеры
  (Hyper-V/WSL vEthernet, Default Switch, VPN). Любое их изменение — «сеть сменилась».
- На каждое изменение (`src/main/link/service.ts:1219-1232`): строка журнала, ping всех соединений, немедленный
  `reconnect`, и `discovery.announceAgain()` — Bonjour goodbye и повторное объявление. Ни debounce, ни порога нет.
- В строке нет старой и новой подписи, поэтому по журналу не видно, какой адрес «сменился».
- Подпись использует ещё `TailnetSelfName` (`src/main/link/tailscale.ts:201`) как ключ кэша.

## Что делаем

1. Подпись — только адреса, по которым связь реально может работать: те же правила, что у `mdnsInterfaces`
   (`src/main/link/discovery.ts:490-499`: IPv4, без `169.254.*`, локальные диапазоны или Tailscale). IPv6 и link-local
   в подпись не входят. Ключ кэша `TailnetSelfName` не должен потерять адрес Tailscale — проверить test-ом.
2. Settle: изменение принимается, когда новая подпись продержалась два чтения подряд; адаптер, который мигает
   туда-обратно в пределах одного интервала, строки не даёт.
3. Строка журнала называет, что изменилось: добавленные и пропавшие адреса (`+<имя> <адрес>`, `-<имя> <адрес>`).

## Готово, когда

- [x] Contract test в `test/contract/link-reconnect.test.ts` рядом с `networkSignature` (`:221`): смена только IPv6,
      только `fe80::`, только `169.254.*`, появление виртуального адаптера без IPv4 — не изменение; новый IPv4 в
      локальном диапазоне — изменение. Сначала красный.
- [x] Test: адрес мигает (A → B → A за два чтения) — ни строки, ни `announceAgain`; новый адрес держится два чтения —
      ровно одна строка и одно объявление.
- [x] Test: строка журнала содержит добавленный и пропавший адрес.
- [x] Test: кэш имени Tailscale по-прежнему сбрасывается при смене адреса Tailscale.
- [x] Прогнать все unit и contract test-ы модуля: `test/contract/link-*.test.ts`, `test/unit/link-*.test.ts`.
- [ ] Пределы test-ов не подняты; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; Windows-job CI зелёный.
- [ ] (вручную, на ПК, после Stable) журнал за час без потока строк.

## Где в коде

- `src/main/link/connections.ts` (`networkSignature`, `watchNetwork`)
- `src/main/link/service.ts` (`:1219-1232`, строка журнала)
- `test/contract/link-reconnect.test.ts`
- Только читать: `src/main/link/discovery.ts`, `src/main/link/tailscale.ts`, `src/main/link/sleep-notice.ts`

## Итог

- Подпись сети (`networkSignature`, `src/main/link/connections.ts`) — только IPv4, которые могут нести связь: не
  internal, не `127.*`, не `169.254.*`, локальный диапазон или Tailscale. IPv6 (временные адреса Windows, `fe80::`) и
  адаптеры без IPv4 изменением больше не считаются.
- Settle в `watchNetwork`: новая подпись принимается, когда два чтения подряд видят её; возврат к принятой подписи
  сбрасывает ожидание; третья подпись во время ожидания начинает своё ожидание; нечитаемое чтение пропускается.
  `stop()` — `clearInterval`, callback-и синхронные, гонки нет. Реальная смена видна через 5–10 s вместо 0–5 s.
- Строка журнала (`src/main/link/service.ts`, `wireAppLink`): `[link] the network of this Machine changed (+Wi-Fi 10.0.0.7,
  -Wi-Fi 192.168.0.193): …`.
- `docs/features/link.md` — абзац «Reconnecting is automatic» про правила подписи и задержку.
- Test-ы — новый `describe` в `test/contract/link-reconnect.test.ts` (fake timers и scripted reader, без сети), сначала
  красные (6 из 6), потом зелёные; все link unit и contract test-ы зелёные; пределы test-ов не трогались.
- Решено без владельца: адрес Tailscale входит в подпись всегда, независимо от «Link through Tailscale» (иначе кэш
  `TailnetSelfName` не увидит смену адреса Tailscale при выключенной настройке); публичные IPv4 в подпись не входят, как
  и в `mdnsInterfaces`; нечитаемое чтение не сбрасывает settle.
- Ручная проверка на ПК — не проверено: нужен ПК после Stable.
