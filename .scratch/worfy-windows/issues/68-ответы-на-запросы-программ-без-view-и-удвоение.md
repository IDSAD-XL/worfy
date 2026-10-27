# 68 — Ответы на `ESC[c`, DECRQM и OSC-запросы цвета: нет ответа без view, двойной ответ при двух view

Type: bug
Status: claimed 2026-10-27T07:08Z
Blocked by: —
Source: follow-up [Ticket-а 39](39-ответы-экрана-считаются-вводом.md) (PR #512, влит 2026-10-19 как `77c473cb`):
«Итог» Ticket-а 39, «Что не проверено (на `fd2f054c`)» и ответ на ревью Mac круга 2 («Не в этом PR: ответы на
другие запросы … — Mac заводит отдельный Ticket»).

## Что происходит

- Программа в Terminal спрашивает терминал: атрибуты устройства (`ESC[c`), состояние режима (DECRQM,
  `ESC[?…$p`), цвета (OSC 10/11/4 с `?`). Отвечает xterm.js того view, который сейчас смонтирован; ответ
  уходит в pty как `terminal.input` с `reply: true`.
- С PR #512 main сам отвечает только на запрос позиции курсора (`ESC[6n`) на всех системах и на `ESC[c`
  консоли на Windows (`src/main/terminal/console-request.ts`). Остальные запросы — по-прежнему view
  (`src/main/terminal/cursor-answers.ts`, шапка файла).
- **Нет view — нет ответа.** Canvas снимает Node вне экрана, окно остаётся подписанным. Запрос, пришедший
  в это время, остаётся без ответа. На macOS это и `ESC[c`. Что делает программа (ждёт, печатает мусор) —
  не запускалось.
- **Два живых view — два ответа.** Каждый смонтированный view отвечает сам; main отбрасывает повтор только
  для ответа о позиции курсора (`TerminalRegistry.write`, `src/main/terminal/pty.ts:1029`).
- Экран без display в main (`@xterm/headless` в worker-е) уже разбирает весь вывод и сам вычисляет
  большую часть этих ответов; сейчас main берёт из них только ответ о позиции.

## Что делаем

1. Сначала замер: на Mac и на ПК — какие запросы приходят от shell-ов и обычных программ (`vim`, `less`,
   `fzf`, PowerShell у prompt-а), что отвечает xterm.js worker-а и что xterm.js view на каждый. Таблица —
   в «Итог».
2. main отвечает на каждый запрос, ответ на который у worker-а совпадает с ответом view, и отбрасывает тот
   же ответ от view (как сейчас для `ESC[6n`): один ответ при любом числе view, ноль или два.
3. Запрос, ответ на который зависит от view (например, цвета темы окна), остаётся за view; при двух view
   main пропускает только первый ответ. Решение и довод — в «Итог».

## Готово, когда

- [ ] Без смонтированного view `ESC[c`, DECRQM и каждый запрос из таблицы пункта 1, на который отвечает
      main, получают ровно один ответ — test на macOS и на Windows.
- [ ] Два смонтированных view: ровно один ответ на каждый запрос — test; мутант без отбрасывания —
      красный.
- [ ] Ввод человека, похожий на ответ (вставка текста `ESC[?1;2c`), доходит до shell-а — test.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full на Mac и вердикт ПК (платформенный PR,
      ADR-0056, пункт 2).

## Тесты

- `test/contract/terminal-cursor.test.ts` — случаи без view и с двумя view для каждого запроса из таблицы.
- `test/unit/terminal-replies.test.tsx` — пометка `reply` у новых ответов view.

## Где в коде

- `src/main/terminal/cursor-answers.ts` — `WORKER_CODE` (`:77`) и что main берёт из ответов worker-а
  (`:212`).
- `src/shared/terminal/cursor-answer.ts` — `isCursorAnswer`: какие ответы view main отбрасывает.
- `src/main/terminal/pty.ts:1026-1030` — `TerminalRegistry.write` с `reply`.
- `src/main/terminal/console-request.ts` — ответ на `ESC[c` консоли Windows.
- `src/renderer/canvas/nodes/TerminalNode.tsx`, `src/renderer/canvas/nodes/terminal-user-input.ts` — ответы
  view.

## Вне скоупа

- Скорость разбора вывода — [Ticket 67](67-разбор-вывода-terminal-worker-на-shell-или-пул.md).
- Старый клиент Linked machine без `reply` (версия протокола link 2) — вопрос из «Итог» Ticket-а 39.

## Итог

### Замер (пункт 1)

Какие запросы программы шлют терминалу, когда никто не отвечает. На ПК — node-pty с `useConptyDll`, как
запускает worfy; на Mac — macOS 26.6.1, node v24.19.0, node-pty 1.2.0-beta.15, `TERM=xterm-256color`, main
`54c2c191`.

| Программа | ПК (Windows 11) | Mac |
| --- | --- | --- |
| PowerShell 5.1 у prompt-а | только запросы самой консоли: `ESC[c` (и `ESC[1t`) | — |
| cmd у prompt-а | только `ESC[c` (и `ESC[1t`) консоли | — |
| Git Bash `bash --login -i` | только `ESC[c` (и `ESC[1t`) консоли | — |
| zsh `-il` | — | запросов нет |
| `/bin/bash` 3.2.57 `-il` | — | запросов нет |
| vim | (из Git) `ESC[6n` ×2, `ESC[>c` ×1, плюс сохранение и возврат заголовка `ESC[22;…t` / `ESC[23;…t` | 9.1: `ESC[6n` ×2, `ESC[>c` ×1, `ESC]11;?BEL` ×1, `ESC]10;?BEL` ×1 |
| less | (из Git) запросов нет | 668: запросов нет |
| fzf | не запускался | не запускался (на Mac не установлен) |

Что консоль Windows (ConPTY) передаёт терминалу, когда запрос пишет ПРОГРАММА: каждый CSI- и DCS-запрос
доходит — DA1 `ESC[c`, DA2 `ESC[>c`, DA3 `ESC[=c`, `ESC[5n`, `ESC[6n`, `ESC[?6n`, DECRQM `ESC[?2004$p` и
`ESC[4$p`, XTVERSION `ESC[>q`, DECRQSS `ESC P $q m ESC \`, XTGETTCAP, `ESC[14t`, `ESC[18t`, `ESC[?u`,
`ESC[?996n`. Запросы цвета OSC `ESC]10;?BEL`, `11;?`, `12;?`, `4;1;?` до терминала на Windows не доходят
вовсе. На Mac vim шлёт OSC 10 и 11, и они до pty доходят: там ответ на цвет и правило двух view важны.

Ответы на один и тот же вывод: worker (`@xterm/headless` 6.0.0, параметры как в `WORKER_CODE`) и view
(`@xterm/xterm` 6.0.0 с параметрами `TerminalNode`).

| Запрос | worker | view | Кто отвечает теперь |
| --- | --- | --- | --- |
| DA1 `ESC[c` | `ESC[?1;2c` | то же | main (на Windows — `console-request.ts`) |
| DA2 `ESC[>c` | `ESC[>0;276;0c` | то же | main |
| DSR `ESC[5n` | `ESC[0n` | то же | main |
| CPR `ESC[6n`, DECXCPR `ESC[?6n` | позиция | то же | main (как с Ticket-а 39) |
| DECRQM `ESC[?2004$p` / после `?2004h` / `ESC[4$p` / `ESC[?9999$p` | `ESC[?2004;2$y` / `ESC[?2004;1$y` / `ESC[4;2$y` / `ESC[?9999;0$y` | то же | main |
| DECRQSS `ESC P $q m ESC \`, `… r …` | `ESC P 1 $ r 0 m ESC \`, `ESC P 1 $ r 1;30 r ESC \` | то же | main |
| DECRQM `ESC[?12$p`, DECRQSS `ESC P $q SP q ESC \` (курсор) | `ESC[?12;1$y`, `ESC P 1 $ r 1 q ESC \` — после ревью | то же (`cursorBlink: true`) | main |
| DA3, XTVERSION, XTGETTCAP, `14/16/18t`, `?u`, `?996n` | нет ответа | нет ответа | никто (как и раньше) |
| OSC 10/11/12/4 с `?` | нет ответа (темы нет) | цвет из темы | view; при двух view — первый ответ |

Скрипты замера (в репозиторий не входят): `t68-capture.cjs`, `t68-pass.cjs`, `t68-answers.cjs` в scratchpad
Session-а на ПК, `t68-capture-mac.cjs` — на Mac.

### Решение (пункты 2 и 3)

- main отвечает сам на каждый запрос, ответ на который у worker-а и у view совпадает: DA1, DA2, DSR 5,
  CPR/DECXCPR, DECRPM (`$y`, private и ANSI), DECRQSS (`ESC P 0|1 $ r … ESC \`). Форма этих ответов —
  `isMainAnswer` в `src/shared/terminal/cursor-answer.ts`; worker пропускает в pty то, что ей отвечает
  (`src/main/terminal/cursor-answers.ts`, слушатель `data`). На Windows DA1 из вывода забирает и отвечает
  `console-request.ts`, worker его не видит — двойного ответа нет.
- `TerminalRegistry.write` с `reply: true` (`src/main/terminal/pty.ts`) отбрасывает ответ view той же
  формы, пока main отвечает: один ответ при любом числе view. Немаркированные данные — ввод человека,
  в том числе вставленный текст `ESC[?1;2c`, — доходят до shell-а всегда.
- Запросы цвета (OSC 10/11/12/4) остаются за view: ответ — цвет темы окна, а у экрана main темы нет. При
  двух view каждый отвечает; main пропускает первый ответ каждого вида (10, 11, 12, `4;<n>`) и
  отбрасывает ответ того же вида от ДРУГОГО клиента в течение `COLOUR_ANSWER_WINDOW_MS` (1000 мс,
  `ColourAnswers` в `cursor-answers.ts`). Тот же view, ответивший второй раз подряд, проходит: программа
  спросила снова. Запросы в main для этого не считаются. Довод: счёт запросов требует разбирать вывод в
  main ради одного вида ответа, а окно по времени закрывает случай «два view отвечают на один запрос».
  Предел окна записан в коде комментарием `shortcut:`: view, ответивший позже окна, даст второй ответ;
  если ответивший view ушёл, новый запрос в пределах окна останется без ответа.
- Без смонтированного view запрос цвета остаётся без ответа: только view знает свою тему.
- Резерв `terminal-user-input.ts` (xterm.js без `onUserInput`) считает ответом обе формы: ответы main и
  ответы цвета.

### Проверено

- `test/contract/terminal-cursor.test.ts`: для каждого запроса таблицы, на который отвечает main, без view —
  ровно один ответ, с двумя view, приславшими маркированные ответы, — ровно один (main-а); оба случая под
  реестром `linux` и `win32`. Набранный или вставленный (без метки) ответ любой из этих форм доходит до
  shell-а. Цвет: без view ответа нет; два view на OSC 11 — проходит один; тот же view дважды — два; другой
  вид цвета от другого view проходит; ответ другого view после окна проходит; ответ цвета без метки
  проходит всегда.
- Мутанты: без отбрасывания в `TerminalRegistry.write` — 24 test-а красные; без отбрасывания в
  `ColourAnswers.pass` — 3 красных.
- `test/unit/terminal-replies.test.tsx`: метка `reply` у ответов view на DA2, DSR, DECRQM, DECRQSS и один
  ответ main на каждый; резерв `watchUserInput` по новым формам. Ответ view на запрос цвета в jsdom не
  проверить: xterm.js отвечает из темы своего renderer-а, а `open()` в test-е ничего не рисует.

### Ревью

- Корректность, medium: экран main создавался без `cursorBlink`, а оба view — с `cursorBlink: true`. На
  DECRQM 12 и DECRQSS стиля курсора main отвечал «не мигает» (`?12;2$y`, `2 q`), а ответ view отбрасывал.
  Исправлено: общая константа `CURSOR_BLINK` (`src/shared/terminal/cursor-answer.ts`) у обоих view и у
  экрана main; два случая добавлены в таблицу contract test-а (8 красных до исправления).
- Low, исправлено: устаревший пример «the device attributes» в документации `terminal.input` и
  `TerminalRegistry.write`; реэкспорт `isMainAnswer` через main; название и повтор запроса в
  `terminal-replies.test.tsx`; в комментарии окна цветов назван таймер скрытого окна Chromium.
- Low, не сделано: правило помеченных ответов разнесено между `pty.ts` и `cursor-answers.ts`; имена
  `cursor-answer(s)` теперь уже того, что в них лежит.

### Что не проверено

- В живом приложении (vim на Mac с двумя окнами) — не запускалось.
- Ответ view на OSC-запрос цвета с меткой `reply` — только в contract test-е через реестр, не через
  настоящий xterm.js view (см. выше).
