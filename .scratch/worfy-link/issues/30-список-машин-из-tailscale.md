# 30 — Список машин из Tailscale в «Link a machine»

Type: task
Status: claimed 2026-10-27T18:24Z
Branch: worfy-link/30
Blocked by: 29, 36, 37
Source: решение владельца 2026-10-18, Q22, вторая часть ([ADR-0070](../../../docs/adr/0070-worfy-link-outside-the-lan-through-an-overlay-network.md), пункт 5): «позже, отдельным Ticket-ом». Код начинается после текущей очереди Epic-а `worfy-windows` (Q21)

## Что происходит

- После Ticket-а 29 машину в tailnet находят руками: имя MagicDNS или IP-адрес и порт из окна другой
  машины.
- Tailscale CLI отдаёт список машин tailnet: `tailscale status --json` (поля `Self` и `Peer`: имя
  MagicDNS, адреса Tailscale, в сети ли машина). CLI есть не у каждого: на macOS приложение Tailscale
  кладёт его не в `PATH`, на Windows — в папку установки.

## Что делаем

1. «Link a machine» при включённой настройке «Связь через Tailscale» показывает машины tailnet рядом с
   найденными через Bonjour, если Tailscale CLI найден. Порт по-прежнему вводится руками: Tailscale его
   не знает.
2. CLI не найден — список не показывается, ввод руками работает. Ошибка CLI не мешает окну.
3. Развилка — к владельцу при claim: где искать CLI на macOS и Windows и показывать ли машины не в сети.

## Готово, когда

- [x] Unit test разбора вывода `tailscale status --json` (запись из фикстуры): имена, адреса, в сети.
- [x] Contract test: CLI нет — окно открывается, списка нет, ошибки нет.
- [x] Ответ владельца по пункту 3 записан в «Итог».

## Где в коде

- `src/main/link/` — новый модуль чтения списка Tailscale (имя выбирает исполнитель).
- `src/shared/ipc/link.ts`, `src/renderer/machines/LinkMachineDialog.tsx`.

## Итог

- **Пункт 3, ответ владельца (2026-10-27).** CLI ищется сначала в `PATH`; затем на macOS —
  `/Applications/Tailscale.app/Contents/MacOS/Tailscale` и `/usr/local/bin/tailscale`, на Windows —
  `%ProgramFiles%\Tailscale\tailscale.exe`. Машины не в сети tailnet показываются серыми с пометкой
  «Offline», выбрать их нельзя. Машина в сети по выбору подставляет адрес в поле; порт по-прежнему
  вводится руками.
- Модуль `src/main/link/tailscale.ts`: `findTailscale` (поиск CLI по правилу выше; на Linux — только
  `PATH`; относительные папки `PATH` пропускаются), `parseTailscaleStatus` (разбор
  `tailscale status --json`), `readTailscalePeers` (запуск и разбор). CLI запускается через
  `execFile` с массивом аргументов `status --json`, без shell, с timeout 3 с (`TAILSCALE_TIMEOUT_MS`).
- Разбор: `Self` (эта машина) в список не входит; имя — первая метка `DNSName` (имя MagicDNS, точка
  в конце отбрасывается вместе с остальными метками), без `DNSName` — `HostName`; адрес — первый IPv4
  из `TailscaleIPs`, без IPv4 — первый адрес; машина без адреса и запись другой формы пропускаются;
  `Online` не `true` — машина не в сети. Порядок: сначала в сети, потом по имени.
- CLI не найден — пустой список, ничего не запускается, в log ничего. CLI упал, не ответил за 3 с или
  напечатал не статус — пустой список и одна строка warn в log (`[link] the tailnet machines could not
  be read …`). Окно ошибки не показывает.
- IPC: новый канал `link.tailscalePeers` (`local`, `src/shared/ipc/link.ts`), отвечает массивом
  `{ name, address, online }`; при выключенной настройке «Link through Tailscale» — пустой массив без
  запуска CLI (`src/main/ipc/link.ts`).
- Окно «Link a machine» спрашивает список, когда настройка включена, и снова при каждом её включении;
  ответ, пришедший после выключения, отбрасывается. Список «In your tailnet» — под машинами Bonjour,
  теми же строками `w-row`, chip «Offline» — тем же стилем, что «Already linked»; цвета — только
  токены темы, обе темы. Выбор подставляет `адрес:` (IPv6 — в скобках) и возвращает фокус в поле.
  Подставляется IP-адрес, а не имя MagicDNS: так связь не зависит от проверки `Host` по имени
  (ограничение Ticket-а 29 с переименованной машиной сюда не доходит).
- Test-ы: `test/unit/link-tailscale.test.ts` (разбор записи `test/fixtures/tailscale/status.json`,
  поиск CLI на macOS, Linux и Windows, отказы CLI, timeout и аргументы без shell на stub-скрипте),
  `test/contract/link-tailscale-peers.test.ts` (настоящие IPC handler-ы: CLI нет — окно открывается
  без problem, список пуст), `test/unit/link-machine-dialog-tailnet.test.tsx` (список, Offline, выбор,
  настройка, поздний ответ). Каждое новое поведение проверено mutant-ом: 22 из 22 убиты.
