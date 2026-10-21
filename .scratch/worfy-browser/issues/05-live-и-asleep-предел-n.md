# 05 — Live и Asleep: правила сна, предел N = 3, проверка `beforeunload`, пороги в Settings

Type: task
Status: open
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

Заполняется при закрытии.
