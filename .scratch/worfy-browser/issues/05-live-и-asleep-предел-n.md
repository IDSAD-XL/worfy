# 05 — Live и Asleep: правила сна, предел N = 3, проверка `beforeunload`, пороги в Settings

Type: task
Status: claimed 2026-10-22T06:05Z
Branch: worfy-browser/05
Blocked by: 04
Source: [spec.md](../spec.md); [ADR-0078](../../../docs/adr/0078-browser-node.md) (Browser Node), пункт 6
(Live и Asleep, правила сна и пробуждения, пороги в Settings), пункт 7 (предел Live, вытесняется тот,
к кому дольше всех не обращались; Browser под управлением Session не засыпает), пункт 15
(`beforeunload`, сверх предела для пользователя, ошибка для Session), пункт 16 (сон смотрит на все
экраны), «Последствия» (процесс Chromium ~100–300 МБ; пробуждение перезагружает страницу). Термин
Browser (Live, Asleep) — `CONTEXT.md`. Код перечитан по main `dd6b0afb`.

## Что происходит

- После Ticket-а 02 каждый Browser Node Layout-а держит живую страницу в слое
  `src/renderer/canvas/overlays/BrowserLayer.tsx`, сколько бы их ни было: каждый — отдельный процесс
  Chromium.
- Настройки worfy на Machine — `appSettingsSchema` (`src/shared/settings/app-settings.ts:93`);
  раздел окна Settings — файл `src/renderer/settings/<Name>Section.tsx`, список собирается сам
  (`src/renderer/settings/sections.ts:35`).
- Реестр Live Browser-ов `src/main/browser/live.ts` и server `src/main/mcp/browser-server.ts`
  появляются в Ticket-е 04, а этот Ticket их правит, поэтому блокер — 04.

## Что делаем

1. **Asleep** — последний screenshot, URL и прокрутка; процесс страницы закрыт, хранилище Browser
   profile на диске остаётся. Рамка показывает снимок; клик по рамке будит Browser: он загружает
   сохранённый URL заново и возвращает прокрутку.
2. **Правила сна** — `src/main/browser/sleep.ts` (новый), чистая функция от состояния Browser-ов,
   видимости на экранах, времени и настроек. Browser засыпает, если:
   - его не видно ни на одном экране дольше порога (по умолчанию ~30 с);
   - zoom Canvas ниже уровня читаемого текста — на всех экранах, где он виден;
   - без фокуса и без действий Session дольше порога (по умолчанию ~5 мин).
   Видимость каждое окно сообщает в main; решение одно — в main.
3. **Предел Live** — не больше N одновременно (по умолчанию 3). При пробуждении или открытии N+1-го
   засыпает Browser, к которому дольше всех не обращались. Не засыпает: Browser, которым сейчас
   управляет Session, и Browser с `beforeunload`.
4. **`beforeunload`.** Перед сном main через CDP спрашивает, есть ли у страницы обработчик
   `beforeunload`. Если есть — Browser не засыпает, на рамке метка «несохранённые изменения».
5. **Все Live заняты** (формой или Session-ой): Browser, который открывает или будит пользователь,
   открывается сверх предела с предупреждением на рамке; Session получает ошибку «все Live Browser-ы
   заняты» и ждёт.
6. **Session.** Вызов инструмента `worfy-browser` будит Asleep Browser. Функции «разбудить»,
   «Session ведёт» и «Session отпустила» — в `src/main/browser/live.ts`; инструменты Ticket-а 04
   зовут их.
7. **Settings** — раздел `src/renderer/settings/BrowserSection.tsx` (новый): все пороги в Settings
   (ADR-0078, п. 6) — N, порог вне экрана, порог без фокуса и порог zoom; значение zoom по
   умолчанию — по вопросу 1.

## Готово, когда

- [ ] Unit `test/unit/browser-sleep.test.ts`: сон вне экрана после порога, на дальнем zoom, без фокуса
      после порога; не засыпает под Session и с `beforeunload`; Browser виден во втором окне — не
      засыпает; при N+1 засыпает самый давний; все N заняты — пользователь сверх предела, Session —
      ошибка «все Live Browser-ы заняты».
- [ ] Contract `test/contract/app-settings.test.ts`: новые поля читаются со значениями по умолчанию из
      старого файла настроек; границы N и порогов.
- [ ] Unit `test/unit/settings-browser.test.tsx`: раздел меняет N, порог вне экрана, порог без
      фокуса и порог zoom.
- [ ] e2e `test/e2e/browser-sleep.spec.ts`: четыре Browser-а — Live три, четвёртый открыл самый давний
      спать; клик будит его с тем же URL и прокруткой; fixture-страница с `beforeunload` не засыпает и
      показывает «несохранённые изменения»; Browser ушёл с экрана — после порога (в test-е — короткий)
      Asleep; снимки `browser-asleep` и `browser-unsaved` в обеих темах.
- [ ] Мутанты красные: вытесняется самый новый, а не самый давний; Browser под Session засыпает;
      видимость считается только по одному окну.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `browser-sleep.test.ts` на вытеснение самого давнего.
- Unit `test/unit/browser-sleep.test.ts` (новый), `test/unit/settings-browser.test.tsx` (новый);
  contract `test/contract/app-settings.test.ts`; e2e `test/e2e/browser-sleep.spec.ts` (новый).

## Где в коде

- `src/main/browser/sleep.ts` (новый)
- `src/main/browser/live.ts`
- `src/main/mcp/browser-server.ts` (пробуждение, ошибка «все Live Browser-ы заняты»)
- `src/shared/ipc/browser.ts` (видимость, состояние Live или Asleep, снимок)
- `src/shared/settings/app-settings.ts` (`appSettingsSchema` `:93`)
- `src/renderer/settings/BrowserSection.tsx` (новый)
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `test/unit/browser-sleep.test.ts` (новый)
- `test/unit/settings-browser.test.tsx` (новый)
- `test/contract/app-settings.test.ts`
- `test/e2e/browser-sleep.spec.ts` (новый)

Только чтение: `src/renderer/settings/sections.ts` (`:35`).

## Вне скоупа

- Кадры живой страницы на других экранах и Linked machine — Ticket 07. Здесь второе окно только
  сообщает видимость.
- Browser, который уходит с Session, — Ticket 06.

## Открытые вопросы

1. **«Уровень читаемого текста».** ADR числа не даёт. Если к началу Ticket-а влит semantic zoom
   `worfy-canvas` 06, порог — его граница уровней; иначе число предлагает исполнитель, решает
   владелец. **Решено владельцем 2026-10-21:** порог сна — zoom 0.4, тот же, что у живой страницы
   Card (`CardNode.tsx`, `LIVE_ZOOM_MIN`); уровни semantic zoom, за которыми он шёл, удалены
   Ticket-ом `worfy-canvas` 20.
2. **Где лежит снимок Asleep** — в памяти main или файлом в папке данных Project-а — и переживает ли
   он перезапуск worfy. ADR не говорит. Не в Layout: Layout read-only Linked machine получает
   (`layout.get` и `layout.changed` — `read`, `src/shared/ipc/layout.ts:16`, `:33`), а снимок ей не
   положен (ADR-0078, п. 14). Если всё же в Layout — main прячет его от Read only (Ticket 07).
3. **После перезапуска worfy** все Browser-ы стартуют Asleep или до N просыпаются сами — ADR не
   решает. Предложение: все Asleep.
4. **Сколько ждёт Session** после «все Live Browser-ы заняты»: повторяет вызов сама или main держит
   очередь — ADR говорит только «ждёт».

## Итог

**Сделано** (ветка `worfy-browser/05`):

1. **Правила сна** — `src/main/browser/sleep.ts`: чистые функции `sleepReason`, `browsersToSleep`, `admit`.
   Browser засыпает, если ни один экран не показывает его на читаемом zoom дольше порога вне экрана
   (вне экрана или zoom ниже порога на всех экранах, где он виден), или если его не трогали (фокус,
   нажатие, прокрутка, вызов Session) дольше порога без фокуса. Не засыпает, пока его ведёт Session
   (идёт вызов или последний вызов был меньше порога без фокуса назад) и пока у страницы есть
   `beforeunload`. При N+1 засыпают самые давние из тех, кому можно; все заняты — пользователь
   открывает сверх предела с пометкой, вызов Session получает «All Live Browsers are busy».
2. **Жизни Browser-ов в main** — `src/main/browser/live.ts`: Live или Asleep, снимок (JPEG через CDP
   `Page.captureScreenshot`) и прокрутка, проверка правил раз в секунду, `wake`, `sessionDrives`,
   `sessionReleases`. Перед сном и перед вытеснением main спрашивает страницу через CDP
   (`DOMDebugger.getEventListeners` на `window`, `src/main/browser/cdp.ts`); после пробуждения
   прокручивает страницу обратно. Фокус и использование main видит сам (`isFocused` guest-а,
   `input-event`): у окна `activeElement` остаётся на первом `<webview>`, когда кликают во второй
   (так упал первый e2e-прогон).
3. **Каналы** `browser.screen`, `browser.lives.list`, `browser.lives.changed`, `browser.wake`,
   `browser.picture` — все `local`. Слой рисует страницу только Live Browser-а и сообщает main, какие
   рамки видны и zoom; рамка Asleep показывает снимок под «Asleep · Click to wake», клик будит;
   метки «Unsaved changes» и «Over the Live limit» — в шапке.
4. **Session** — `browser-server.ts`: вызов будит Asleep Browser, `browser_open` занимает место до
   создания Node-а; «все заняты» — ошибка до того, как Session что-либо взяла.
5. **Settings → Browser** — N (1–10), вне экрана (1–3600 с), без фокуса (1–240 мин), zoom (0,1–1),
   поле `browserSleep` app settings, как `sessionArchive`: хранится только выбранное.

**Решения без владельца** (вопросы 2–4 и одно своё):

- Вопрос 2: снимок — в памяти main, не в Layout и не на диске; после перезапуска его нет.
- Вопрос 3: после перезапуска до N Browser-ов просыпаются сами — сначала видимые; остальные Asleep
  без снимка. «Все Asleep» оставляли бы после перезапуска пустые рамки и ломали проверку «тот же URL
  после перезапуска» Ticket-ов 02 и 03.
- Вопрос 4: очереди в main нет; Session получает ошибку и повторяет вызов сама.
- Дальний zoom засыпает по тому же порогу, что и «вне экрана», а не сразу: короткий взгляд на весь
  Canvas не перезагружает все страницы.

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (8394 теста); gate fast —
«[gate] green (fast)». e2e под `/tmp/worfy-e2e.lock`: `browser-sleep.spec.ts` и все остальные
`browser*.spec.ts` — 32 passed. Мутанты (в своём worktree, восстановлены из копии):

| Мутант | unit `browser-sleep` | e2e `browser-sleep.spec.ts` |
| --- | --- | --- |
| вытесняется самый новый, а не самый давний | exit 1, 2 теста | exit 1 |
| Browser под Session засыпает | exit 1, 1 тест | — |
| видимость только по первому окну | exit 1, 2 теста | — |
| `beforeunload` не находится | — | exit 1 |
| Session берёт Browser до пробуждения | exit 1, 1 тест | — |
| `browser_open` создаёт Node до проверки предела | exit 1, 1 тест | — |

Снимки: [Asleep, светлая](../evidence/05-browser-asleep-light.png),
[тёмная](../evidence/05-browser-asleep-dark.png); [«Unsaved changes», светлая](../evidence/05-browser-unsaved-light.png),
[тёмная](../evidence/05-browser-unsaved-dark.png).

**Вне следа:** `src/main/settings/store.ts` (хранение `browserSleep`), `src/main/browser/cdp.ts`
(вопросы странице перед сном), `src/main/ipc/browser.ts` (handler-ы), `src/renderer/browser/lives.ts`
(новый: жизни Browser-ов в окне), `src/renderer/canvas/nodes/BrowserNode.css`,
`test/unit/browser-layer.test.tsx` (fake `browser.lives.list`: слой рисует только Live).

**Раунд правок 1** (ревью correctness и tests PR #741):

1. Удалённый Project (или Project Linked machine в окне) больше не ломает проверку: `browsersOf`
   отвечает `null` для Project-а, которого на этой Machine нет, ошибка чтения ловится по Project-у и
   пишется в log один раз, `check()` по таймеру ловит отказ. Записи такого Project-а забываются;
   Browser-ы остальных Project-ов засыпают как прежде.
2. Browser в двух окнах одного Project-а: main хранит все его страницы. `beforeunload` спрашивается у
   каждой, фокус любой из них считается использованием; когда закрывается окно, которое ведёт
   Session, ведёт страница другого окна. Shortcut «ведёт окно, сообщившее последним» остаётся до
   тикета 07.
3. Первый экран Project-а освобождает места через `admit`: вытесняются Live Browser-ы без страницы,
   которых не показывает ни один экран (Browser-ы прошлого Project-а окна). То же для Asleep
   Browser-а без снимка, видимого на читаемом zoom: он просыпается сам, если такое место есть.
4. Вызов Session будит Browser, только пока какое-то окно показывает его Project; иначе отказ «No
   window of worfy on this Machine shows this Project's Canvas…» до того, как что-либо уснуло.
5. Низкие: уменьшение N в Settings действует на ближайшей проверке (`fitLimit`: лишние, кому можно,
   засыпают, остальные помечены «Over the Live limit»); страница, которую нельзя спросить (открыт
   DevTools), держит Browser Live без метки «Unsaved changes»; Browser без страницы при сне теряет
   старый снимок и прокрутку; записи Project-а, которого не показывает ни одно окно и чьи Browser-ы
   все Asleep, удаляются (его следующий экран — снова первый), так что таймер не читает его файлы;
   `stopLiveBrowsers` на `will-quit`.

**Решение без владельца (раунд 1):** Asleep Browser без снимка, видимый на читаемом zoom, просыпается
сам, если для него есть место без закрытия страницы. Иначе после возврата к Project-у его рамки
оставались бы пустыми — тот же дефект, что в пункте 3, только в обратную сторону.

**Проверки раунда 1.** `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (8409 тестов); gate fast —
«[gate] green (fast)»; все `browser*.spec.ts` под `/tmp/worfy-e2e.lock` — 32 passed. Мутанты
(восстановлены из копии, `cmp` совпал): каждый — exit 1 на `test/unit/browser-sleep.test.ts` или
`test/unit/browser-node-life.test.tsx`:

| Мутант | Красных тестов |
| --- | --- |
| чтение Browser-ов Project-а без `catch` | 1 |
| `beforeunload` спрашивается только у ведомой страницы | 1 |
| фокус только ведомой страницы | 1 |
| первый экран без освобождения мест | 1 |
| нет отказа для Project-а без окна | 1 |
| нет `sessionDrives` в `browserToolCaller` | 1 |
| нет `sessionReleases` в `browserToolCaller` | 1 |
| видимость только по последнему окну (`.slice(-1)`) | 1 |
| порог без фокуса `idleMinutes * 1000` | 1 |
| уменьшение N не действует | 1 |
| страница без ответа = «Unsaved changes» | 1 |
| страница без ответа засыпает | 1 |
| старый снимок у Browser-а без страницы | 1 |
| записи закрытого Project-а не удаляются | 1 |
| метки «Over the Live limit» нет | 1 |
| метки остаются на Asleep рамке | 1 |

**Вне следа (раунд 1):** `src/main/index.ts` (`stopLiveBrowsers` на `will-quit`),
`test/contract/browser-tools.test.ts` (окно сообщает экран Project-а, как слой Browser-ов),
`test/unit/browser-node-life.test.tsx` (новый).
