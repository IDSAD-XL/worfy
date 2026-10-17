# 05 — Terminal на несколько экранов: вывод всем, replay при входе, размер по последнему печатавшему экрану

Type: task
Status: done 2026-10-08
PR: #159
Blocked by: 03
Source: решения владельца 2026-10-07: Q2 (обе машины работают одновременно, общее состояние живое), Q3 (с другой машины можно всё, кроме действий, которым нужен рабочий стол машины Project-а, — в том числе печатать в Terminal), Q14 (размер Terminal — у экрана, где последним печатали или кликнули); [spec.md](../spec.md); [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md) — несколько экранов на одном Project-е

## Что происходит

- У shell-а Terminal Node-а один получатель вывода — окно, открывшее его последним. Handler-ы
  домена хранят `owners: Map<key, Window>` (`src/main/ipc/terminal.ts:46-62`); `terminal.open`
  делает получателя из `event.sender` (`windowSink`, `:24-34`, вызов — `:65-73`).
- `TerminalRegistry.open` для работающего shell-а заменяет получателя: `running.sink = sink`
  (`src/main/terminal/pty.ts:193-199`). Второе окно, открывшее тот же Terminal, забирает вывод у
  первого [вывод из кода; с двумя окнами не запускали].
- Тот же `open` подгоняет pty (псевдотерминал, в котором работает shell) под размер открывшего:
  `running.pty.resize(cols, rows)` (`pty.ts:196-198`).
- Вывод: на каждый чанк `onData` — одно событие `terminal.output {projectId, nodeId, data, end}`,
  без склейки чанков (`pty.ts:239-242`; схема — `src/shared/ipc/terminal.ts:57-60`). `end` — длина
  всего вывода до конца чанка.
- Вход посреди потока уже есть. `ReplayBuffer` держит последние 256 КиБ вывода (`REPLAY_LIMIT`,
  `pty.ts:25`; класс — `:51-82`). Ответ `terminal.open` несёт `replay` и `end` (`pty.ts:199`). View
  пропускает то, что уже показал (`src/renderer/canvas/nodes/TerminalNode.tsx:93-102`, `:160-162`).
- Размер. У pty один размер. Шлёт его только view, смонтированный в окне последним
  (`TerminalNode.tsx:123-134`; правило — `src/renderer/canvas/nodes/terminal-views.ts:22-35`, так
  устроен режим фокуса с двумя view одного shell-а в одном окне). Main применяет любой
  `terminal.resize` от любого окна (`terminal.ts:77-79`, `pty.ts:270-273`).
- Ввод: `terminal.input` от любого окна пишется в pty (`terminal.ts:74-76`; view —
  `TerminalNode.tsx:115-117`).
- Конец shell-а: уничтожение окна-владельца закрывает все его shell-ы (`terminal.ts:54-61`). То же
  в комментарии контракта (`src/shared/ipc/terminal.ts:9-10`) и в contract test
  `test/contract/terminal.test.ts:209`.
- Restart. `terminal.exit` переводит view в `exited` и отключает его (`TerminalNode.tsx:109-113`).
  Новый shell открывает только view, где нажали Restart (кнопка — `:224`, `restart: run > 0` —
  `:154`). View на другом экране осталось бы в `exited`, а его счётчик `written` больше `end`
  нового shell-а: вывод нового shell-а оно пропускало бы [вывод].
- Пропускная способность «одно событие на чанк» не мерялась.
- Ticket 03 даёт реестр клиентов — общий вид окна и соединения Linked machine-а (`send`, `id`,
  `isDestroyed`, событие `destroyed`) — и helper второго окна в e2e.

## Что делаем

1. **Подписчики вместо владельца** (Q2, Q3). У shell-а — набор подписчиков: клиенты реестра
   Ticket-а 03, вызвавшие `terminal.open` для этого Node-а. `TerminalSink` (`pty.ts:96-100`)
   становится рассылкой: каждый чанк и `exit` уходят всем живым подписчикам с одним `end`. Второй
   `open` добавляет подписчика, а не заменяет.
2. **Новый экран входит через готовый replay.** `open` отдаёт `replay` и `end`, дальше идут живые
   чанки. Пропуск уже показанного в view не меняем.
3. **Когда shell кончается.** Подписчик уходит своим событием `destroyed`. Shell закрывается, когда
   ушёл последний подписчик: с одним окном — как сейчас. Q14 решает только размер Terminal;
   переживает ли shell все экраны, владелец не решал. Session переживает окно по Ticket-у 04,
   Terminal — нет.
4. **Размер — у экрана, где последним печатали или кликнули** (Q14). Main хранит по shell-у
   владельца размера и последний размер от каждого подписчика.
   - `terminal.input` от клиента X: X становится владельцем. Если размер X не равен размеру pty —
     сначала `resize`, потом запись.
   - Клик в Terminal (mousedown по `terminal-screen`) шлёт новый invoke
     `terminal.takeSize {projectId, nodeId, cols, rows}`: X становится владельцем, pty — его
     размера. Шлёт только view, который в своём окне задаёт размер (`isLastView`).
   - `terminal.resize` от владельца применяется сразу, от остальных — только запоминается.
   - `open` подключающегося при владельце-другом клиенте размер pty не меняет (сейчас меняет,
     `pty.ts:197-198`). Без владельца (первый `open`, перезагрузка того же окна) — как сейчас.
   - Владелец ушёл — размер берёт оставшийся подписчик, печатавший последним, иначе приславший
     размер последним.
   - Экран без размера видит вывод, свёрстанный под чужую ширину, пока сам не напечатает или не
     кликнет. Это следствие Q14; подсказку не делаем.
5. **Restart с одного экрана.** Main шлёт всем подписчикам новое событие
   `terminal.started {projectId, nodeId, pid}`. View в `exited` на другом экране по нему
   подключается заново (`open` без `restart`) и сбрасывает `written`.
6. **Замер.**
   - Contract на настоящем pty: 10 МБ вывода (`head -c 10000000 /dev/zero | tr '\0' a`), два
     подписчика. Печатаются число событий `terminal.output`, время до последнего байта, задержка
     event loop main (`perf_hooks.monitorEventLoopDelay`, p99).
   - e2e: время, пока оба окна покажут маркер конца вывода, против одного окна.
   - Цифры печатаются всегда. С `WORFY_PERF=1` они проверяются, как в
     `test/e2e/epic-frame.spec.ts:893`.
7. **Склейка чанков — только если замер покажет нужду:** два окна медленнее одного больше чем
   вдвое или p99 задержки event loop больше 100 ms. Тогда чанки одного shell-а копятся до 16 ms
   или 64 КиБ и уходят одним событием с `end` последнего чанка; порядок и `end` прежние. Пороги —
   предложение этого Ticket-а. Цифры и решение — в «Итог». Замер по сети LAN — в приёмке Epic-а
   (Ticket 16).
8. **Пометка каналов.** `terminal.takeSize` и `terminal.started` — каналы Project-а: Linked
   machine-у доступны. Если Ticket 08 уже влит, пометка ставится при объявлении канала; иначе их
   помечает Ticket 08.

**Не входит:** сеть (транспорт — Ticket 01, каналы для Linked machine-а — Ticket 08; здесь
проверка на двух окнах одного worfy), Session из `agent.start` (Ticket 04), shell на Windows
(Epic worfy-windows).

## Готово, когда

- [x] Contract `test/contract/terminal.test.ts`: два клиента открыли один Terminal — оба получают каждый чанк с одним `end`; второй `open` не отнимает вывод у первого. На нынешнем main test красный: первый клиент перестаёт получать вывод.
- [x] Contract: второй клиент подключается к работающему shell-у — `replay` и `end` как в `:194`; следующие чанки не повторяют replay.
- [x] Contract, размер (spy на `resize` поддельного `SpawnPty`): A печатает — pty размера A; `terminal.resize` от B pty не меняет; `terminal.input` от B — pty размера B до записи; `terminal.takeSize` от A — снова размер A; `open` третьего клиента размер не меняет; A уничтожен — pty размера B.
- [x] Contract: один из двух клиентов уничтожен — shell жив, второй получает вывод; уничтожен последний — shell закрыт и не помечен как exited (как `:209` сейчас).
- [x] Contract: Restart от A — B получает `terminal.started` с новым pid; `open` от B подключается к новому shell-у.
- [x] e2e `test/e2e/terminal.spec.ts`, два окна одного worfy разного размера (helper Ticket-а 03): маркер, напечатанный `echo` в окне 1, виден в окне 2; окно 2, открытое после вывода, показывает прежний вывод (replay).
- [x] Тот же e2e: после ввода в окне 2 `tput cols` (helper `printSize`, `:202`) печатает ширину окна 2; после клика и ввода в окне 1 — ширину окна 1.
- [x] Тот же e2e: закрытие окна 1 — shell жив в окне 2 (тот же `data-pid`); Restart в окне 1 — окно 2 показывает `running` с новым pid.
- [x] Замер напечатан в выводе test-ов (число событий, время, p99); цифры и решение о склейке — в «Итог». Если склейка сделана — contract: чанки за 16 ms уходят одним событием с `end` последнего, текст без потерь.
- [x] Одно окно — как раньше: `test/e2e/terminal.spec.ts`, `test/e2e/focus.spec.ts` (Terminal в режиме фокуса, `:315`) и `test/unit/terminal-views.test.tsx` зелёные без правки ожиданий. Исключение — `test/contract/terminal.test.ts:209`: теперь это «ушёл последний подписчик».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально (команда — `rules.md` Profile-а worfy) — exit 0 (e2e идут в нём).

## Тесты

Сначала падающий test — contract «два клиента получают каждый чанк» в
`test/contract/terminal.test.ts`. В его harness уже есть поддельное окно `makeWindow` (`:96-105`) и
открытие от другого окна, `h.open(NODE, size, other)` (`:200`). Потом contract размера, потом e2e.

Размер в contract — spy на `resize` поддельного `SpawnPty` (`pty.ts:94`). В e2e — `tput cols` через
helper `printSize` (`terminal.spec.ts:202`). Второе окно — helper Ticket-а 03; его размер —
`BrowserWindow.getAllWindows()[1].setSize(...)` через `app.evaluate`.

Замер не валит CI: без `WORFY_PERF=1` цифры только печатаются. В «Итог» — как падал первый test.

## Где в коде

- `src/main/ipc/terminal.ts`
- `src/main/terminal/pty.ts`
- `src/shared/ipc/terminal.ts`
- `src/renderer/canvas/nodes/TerminalNode.tsx`
- `test/contract/terminal.test.ts`
- `test/e2e/terminal.spec.ts`

Реестр клиентов — из Ticket-а 03, его файл назван в «Итог» Ticket-а 03; правка реестра не нужна.
Файл terminal-views.ts рядом с TerminalNode.tsx не меняется: правило «размер задаёт последний view
окна» остаётся внутри окна.

## Итог

- **Подписчики вместо владельца.** `TerminalRegistry` (`src/main/terminal/pty.ts`) держит по Node-у
  набор подписчиков — клиентов реестра Ticket-а 03, вызвавших `terminal.open`. Клиент узнаётся по
  самому объекту, а не по id: клиент без окна может вернуться под id старого, пока `destroyed`
  старого в пути. Каждый чанк, `exit` и новое событие `terminal.started` уходят всем подписчикам
  с одним `end`; сбой одного не останавливает остальных. `open`, `write`, `resize`, новый
  `takeSize` принимают клиента; новый `leave(client)` вызывается из `src/main/ipc/terminal.ts` по
  `destroyed` клиента (один слушатель на клиента). Подписчики Node-а переживают Restart и
  забываются, когда shell закрыт (`terminal.close`, Node ушёл из Layout, Project ушёл из списка).
- **Shell живёт, пока есть хоть один подписчик**; ушёл последний — shell закрыт и не помечен как
  exited (с одним окном — как раньше). *Решено без владельца (рекомендованный вариант Ticket-а),
  подтверждено владельцем 2026-10-12.*
- **Размер (Q14).** `terminal.input` и `terminal.takeSize` (mousedown по `terminal-screen`, в фазе
  capture, только от view, который в своём окне задаёт размер, `isLastView`) делают клиента
  владельцем размера; pty берёт его размер до записи. `terminal.resize` владельца применяется
  сразу, остальных — запоминается. `open` при владельце-другом клиенте размер не меняет, без
  владельца или от него самого — как раньше. Ушёл владелец — размер у подписчика, который последним
  печатал *или кликал*, иначе у приславшего размер последним. Клик считается наравне с вводом —
  *решено без владельца, подтверждено владельцем 2026-10-12.* Pty не дёргается `resize`-ом, если размер тот же.
- **Клиент, не открывший Terminal:** его `terminal.resize` и `terminal.takeSize` ничего не меняют
  (без ошибки); его `terminal.input` пишется в pty, как раньше, но владельцем размера его не
  делает. `terminal.open` от уже уничтоженного клиента — ошибка «the client is gone», shell не
  стартует; клиент, уничтоженный, пока shell стартовал, уходит сразу после ответа. *Решено без
  владельца, подтверждено владельцем 2026-10-12.*
- **Restart с одного экрана.** Main шлёт `terminal.started {projectId, nodeId, pid}` всем подписчикам
  (и открывшему). View в `exited` (не в процессе `open` и не подключённый) по нему открывает Terminal
  заново без `restart`: новый xterm, `written` с нуля. View, у которого `open` ещё в пути, событие
  пропускает — новый shell ему отдаёт его же `open`. Так же подключается второй view того же окна
  (режим фокуса). Вывод, пришедший в view после `exit`, больше не копится в очереди.
- **Пометка каналов.** Ticket 08 не влит (`Status: open`): `terminal.takeSize` и
  `terminal.started` помечает он.
- **Как падал первый test** (`test/contract/terminal.test.ts`, describe «one Terminal on several
  screens» и «the size of a Terminal…», на коде main): 7 красных — первый клиент после второго
  `open` не получил ничего (`expected '' to match /two-screens\r?\n/`); `replay + чанки` второго
  клиента не равны выводу первого; уничтожение окна, открывшего последним, закрыло shell
  (`expected false to be true`); B не получил `terminal.started` (`expected [] to deeply equal
  [Array(1)]`); `open` B изменил размер (`{cols: 100, rows: 30}` вместо `80×24`); `no handler for
  terminal.takeSize`.
- **Замер** (Mac владельца, 2026-10-08). Contract, настоящий pty, 10 МБ
  (`head -c 10000000 /dev/zero | tr '\0' a`):
  один подписчик — 9770 событий `terminal.output`, последний байт через 331 ms, p99 задержки event
  loop main 12 ms; два подписчика — 9781 событие на экран, 313 ms, p99 13 ms. e2e, два окна
  (время, пока каждое окно покажет маркер после 10 МБ): одно окно 465 ms / два окна 517 ms (первый
  прогон), 803 / 657 ms (второй). **Склейка чанков не сделана:** два окна не медленнее одного
  вдвое, p99 далеко ниже 100 ms. Цифры печатаются всегда (в сессии агента vitest прячет вывод
  прошедших test-ов — видно с `--silent=false`), с `WORFY_PERF=1` проверяются. Замер по LAN — Ticket 16.
- **e2e** `test/e2e/terminal.spec.ts`, test «one Terminal on two windows…»: окно 2 — helper
  `openSecondWindow` Ticket-а 03, размер 980×700; разный размер view даёт режим фокуса в окне 2
  (плитка во всё окно; ширина Node-а на Canvas общая для окон, от размера окна не зависит).
  Проверены: replay в окне 2, живой вывод из окна 1, `tput cols`/`lines` по последнему
  печатавшему окну (74×21 / 131×39), один клик без ввода в окне 1 отдаёт размер окну 1 (команда
  окна 2 читает размер через 2 с), Restart в окне 1 — окно 2 (плитка и Canvas) `running` с новым
  pid, закрытие окна 1 — shell жив в окне 2 с тем же pid.
- **Снимки** (окно 1 — Canvas, окно 2 — режим фокуса; в окне 2 вывод свёрстан под ширину окна 1 —
  следствие Q14, подсказки нет): [окно 1, светлая](../evidence/05-two-windows-1-light.png),
  [окно 1, тёмная](../evidence/05-two-windows-1-dark.png),
  [окно 2, светлая](../evidence/05-two-windows-2-light.png),
  [окно 2, тёмная](../evidence/05-two-windows-2-dark.png). Видимых элементов Terminal Node не
  прибавилось.
- **Mutation testing** (мутанты в своём worktree, восстановление из копии): рассылка только
  последнему подписчику; `open` всегда меняет размер; ввод не делает владельцем; `resize` от
  любого применяется; уход владельца не передаёт размер; выбор преемника без учёта ввода/клика;
  нет `terminal.started`; уход последнего не закрывает shell; нет проверки уничтоженного клиента
  после `open` и до него — каждый краснит `test/contract/terminal.test.ts`. В renderer: нет
  переподключения по `terminal.started`, нет `takeSize` по клику — каждый краснит e2e.
- **Проверки** (2026-10-08, ветка `worfy-link/05`): `pnpm lint && pnpm typecheck && pnpm test` — exit 0
  (145 файлов, 2799 test-ов); gate fast — exit 0, «зелено»; `GATE_SCOPE=all` gate full: первый
  прогон — exit 2, упал только известный нестабильный `test/e2e/epic-frame.spec.ts:721` (длинные
  имена Ticket-ов, вне следа), повтор — exit 0, «[gate] зелено (full): lint typecheck test test:e2e
  test:package». CI PR — `check` pass.

Гейт Wave 2: `VERIFIED` с первого круга (PR #159, влит `ae896af`); снимки ревьюера в обеих темах — живой вывод,
exit и Restart в двух окнах. Долги ревьюера (не блокируют):
- [low] `src/main/terminal/pty.ts:312` — try/catch в `broadcast` не покрыт test-ом (mutant без него проходит 37/37).
- [low] `src/main/terminal/pty.ts:484` — удаление набора подписчиков после `close()` не покрыто test-ом.
