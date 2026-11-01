# 14 — Topic Browser

Type: task
Status: done 2026-11-01T01:54Z
PR: #1168
Blocked by: 10
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/browser.md` до одного экрана. Страницы остаются источником и полной версией. Если приёмка пилота поменяла формат, Topic следует ей.

## Что делаем

1. Простой уровень: живая схема и короткий текст, понятный без знания кода. Объём судит автор по этому Feature: текст должен читаться быстро, но его не режут под число слов (Q5).
2. Under the hood, свёрнут: техническая схема потока данных, короткий текст, таблица главных файлов и важные лимиты.
3. Английский и русский в одном PR; технические термины и названия UI по-английски.
4. Страницы-источники и их SHA в реестре Topic-ов.

## Готово, когда

- [ ] Каждое утверждение и подпись на схемах сверены с кодом вторым агентом.
- [ ] Снимки: обе темы, оба языка, reduced motion, развёрнутый Under the hood, в `.scratch/worfy-guide/evidence/`.
- [ ] Topic читается быстро: второй агент называет места, которые можно убрать.
- [ ] Tokens автора и проверки в `## Итог`.

## Тесты

Новых нет: test-ы реестра из Ticket-а 03 покрывают Topic.

## Где в коде

- `src/renderer/guide/`, `docs/features/browser.md` — только чтение страниц.

## Итог

Topic `browser` (`src/renderer/guide/topics/browser/`): `Scene.tsx` (простой уровень, `viewBox` 976×420, 7 блоков,
4 связи, 5 шагов проигрывателя), `Flow.tsx` (поток данных в Under the hood, 1040×476, 8 блоков, 12 связей), обе схемы
в `spec.ts`, тексты `en.json` и `ru.json`, `topic.json` и одна строка `registry.ts` (ключи поиска `chromium`, `sign-in`,
`origins`). `topic.json` сверен с `docs/features/browser.md` на 244b3394 (последний commit страницы). Блок Browser на
Map of worfy уже ведёт в Topic `browser`. Блок Canvas на схеме ведёт в Topic `canvas`, блок Session — в Topic
`sessions`; остальные блоки — сам этот Topic, они только подсвечиваются.

Решено без владельца:
- Цвета групп. Browser, Asleep Browser, Browser profile и страница (`<webview>`) — `tools`: Browser profile — вторая
  Feature той же страницы. Session и Claude Code — `agents`. Код самого worfy — MCP-сервер `worfy-browser`, правила сна,
  LiveBrowsers, CdpPage, Screencast, слой Browser-ов, другой экран — нейтральная `machine`. Одна вещь — одна группа на
  обеих схемах.
- На простой схеме нет блока «вы»: действия человека (вход руками, takeover, клик) сказаны в шагах 1, 4 и 5, как в
  Topic-е Sessions. Session не связана с Browser напрямую: она доходит до страницы только через свой сервер
  `worfy-browser`, и стрелки идут так же.
- Сайт и origin-ы — не блок, а часть шага 3: на схеме у сайта нет группы.
- Ключ `browser` в реестр не добавлен: «browser» в Command palette по-прежнему первым находит New browser.
  Проверено одноразовым test-ом (rankItems по buildCommands с New browser, New terminal, New note и New card, 150
  запросов — заголовки, их слова и ключи всех команд): первое место изменилось только у трёх новых ключей Topic-а, у
  которых раньше совпадений не было. Test удалён до commit-а. Команды «Browser profiles» в палитре нет.

**Утверждения и их источники.** `b.md` = `docs/features/browser.md` на 244b3394.

| Что на схеме или в тексте | Источник |
|---|---|
| Browser — Node на Canvas со страницей Chromium; подпись Canvas «a Browser is a Node»; «Live: a Chromium page» | `b.md:3`, `:10` |
| Вы ходите в нём сами, а Session ведёт его инструментами; «drives it with tools» | `b.md:10-11` |
| Browser profile — сохранённый вход одной роли, Browser открывается под ним; «the sign-in of one role» | `b.md:3-4`, `:310` |
| Session-ы приходят со входом и паролей не видят; связь «opens signed in» | `b.md:311` |
| Шаг 1: вход руками в Browser; profile хранит cookies, их делят все Browser-ы этого profile | `b.md:310-312` |
| Шаг 2: `browser_open` открывает Browser рядом с Node-ом Session, под существующим profile | `b.md:13-14`, `:138`, `src/main/mcp/browser-server.ts:3-4` |
| Блок `worfy-browser`: MCP-сервер, один на Session; «browser_* tools»; «opens, drives» | `b.md:131-145`, `src/shared/browser/tools.ts:13`, `src/main/mcp/browser-server.ts:1-5` |
| Шаг 3: Session читает, кликает и печатает; остаётся на origin-ах profile; не печатает в поле пароля | `b.md:135-145`, `:152-153`, `:168`, `src/main/browser/origins.ts:1-5`, `src/shared/browser/tools.ts:30-31` |
| Шаг 4: пока Session ведёт Browser, нажатие или клавиша на странице забирает его, вызовы Session отклоняются; Return control to Claude отдаёт обратно | `b.md:123-126`, `:65`, `src/main/browser/live.ts:9-12` |
| Шаг 5, блок Asleep Browser «no page; wakes on a click»: неиспользуемый или невидимый Browser может уснуть; клик или вызов Session будит, страница грузится заново | `b.md:69`, `:79-87`, `:103-104` |
| Блок «Sleep rules», «3 Live at once by default», «puts to sleep» | `b.md:70`, `:74`, `:79`, `src/shared/settings/app-settings.ts:169` |
| Область «NOT NODES»: profile, сервер и правила — не Node-ы | `b.md:313`, `:131`, `:70` (profile хранится на Machine, сервер — у Session, правила проверяет main) |
| UTH: страница — `<webview>`, слой под всеми Node-ами рисует её на месте рамки; zoom её масштабирует, Node-ы закрывают; блоки «Page», «Browser layer: under all Nodes» | `b.md:239-242`, `src/renderer/canvas/overlays/BrowserLayer.tsx:1-8` |
| UTH: нет preload и Node integration, sandbox; «<webview>, no app powers» | `b.md:255-257`, `src/main/browser/attach-policy.ts:1-3` |
| UTH: main хранит состояние каждого Browser и раз в секунду проверяет правила сна | `b.md:70`, `:243-244`, `src/main/browser/live.ts:44-48`, `:146` |
| UTH: пока Session ведёт, переход главного frame вне origin-ов отменяется в домене Fetch | `b.md:249-251`, `src/main/browser/cdp.ts:383`, `:412`, `:428` |
| Поток: слой → main `browser.screen`; main → слой `browser.lives.changed` (Live и Asleep); слой рисует `<webview>` только для Live Browser-ов, которыми владеет это окно (`here`) | `b.md:201`, `:285-287`, `src/renderer/browser/lives.ts:31`, `:82`, `src/main/browser/live.ts:30-31`, `:1019` |
| Поток: слой → CdpPage `browser.page.live`, main делает CdpPage; CdpPage → страница «debugger», `webContents.debugger` | `b.md:246`, `:287-288`, `src/renderer/browser/control.ts:106`, `src/main/browser/live.ts:1-4`, `:321`, `src/main/browser/cdp.ts:2` |
| Поток: Claude Code → `worfy-browser` «tool call»; сервер → LiveBrowsers «holds, wakes»; сервер → CdpPage «CDP commands» | `b.md:288-290`, `src/main/mcp/browser-server.ts:400-421`, `src/main/browser/live.ts:44-52` |
| Поток: LiveBrowsers «Live or Asleep, who drives»; LiveBrowsers → Screencast «each new page» | `src/main/browser/live.ts:1-13`, `:44-48`, `:210` |
| Поток: другой экран (окно или Linked machine с полным доступом) → Screencast `browser.frames.watch`; Screencast → экран `browser.frame` «JPEG frames for watchers»; экран → LiveBrowsers `browser.input` | `b.md:201-203`, `:213`, `:222`, `:290-291`, `src/main/browser/screencast.ts:1-8`, `src/renderer/browser/frames.ts:22`, `:37`, `:80`, `src/main/browser/live.ts:401-405` |
| Таблица файлов: назначение каждого из шести | `b.md:268-270`, `:274`, `:280`, `:397`; шапки самих файлов |
| Лимит: Live сразу 3 по умолчанию, до 10, на всю Machine; по умолчанию сон через 30 с вне экрана или 5 мин без использования | `b.md:74-76`, `:97`, `src/shared/settings/app-settings.ts:145`, `:169` |
| Лимит: `browser_type` до 10 000 символов, `browser_read` обрезает на 60 000 | `b.md:141`, `:143`, `src/shared/browser/tools.ts:25`, `:62` |
| Лимит: в Autopilot Session видит только profile-ы с отметкой Available to Autopilot | `b.md:363-365`, `src/main/mcp/browser-server.ts:87` |

**Снимки** (Playwright против сборки ветки, окно 1280×800, у каждого есть пара `-dark`):
[EN](../evidence/14-browser-en-light.png) / [dark](../evidence/14-browser-en-dark.png),
[RU](../evidence/14-browser-ru-light.png) / [dark](../evidence/14-browser-ru-dark.png),
[подсветка worfy-browser](../evidence/14-browser-lit-en-light.png), [шаг 2](../evidence/14-browser-step-en-light.png),
[reduced motion, RU](../evidence/14-browser-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/14-browser-under-the-hood-en-light.png) / [RU](../evidence/14-browser-under-the-hood-ru-light.png),
[таблица файлов и лимиты EN](../evidence/14-browser-under-the-hood-files-en-light.png) / [RU](../evidence/14-browser-under-the-hood-files-ru-light.png),
[подсветка LiveBrowsers на потоке данных](../evidence/14-browser-flow-lit-en-light.png).
Контраст текста: каждый видимый текст Topic-а (HTML, подписи блоков, областей и связей обеих схем, до 102 текстов на
замер) против своего фона, обе темы, EN и RU — минимум 5,60:1 в светлой и 5,93:1 в тёмной, ниже 4,5:1 нет ни одного.

**Объём.** Простой уровень: 47 слов EN, 40 RU. Under the hood (текст, таблица файлов и лимиты вместе): 160 EN, 139 RU.

**Доработка после REJECTED (PR #1168, ревью medium).** Предложение о слое в описании потока данных (EN и RU) сужено:
слой рисует `<webview>` только для Live Browser-ов, которыми владеет это окно; другие окна показывают их кадрами
(`b.md:201`, `:286`, `src/main/browser/live.ts:30-31`). На левой стороне LiveBrowsers концы связей `browser.screen`,
`browser.lives.changed` и `browser.input` разведены (сдвиги −10, 6 и 24), на правой стороне слоя — `browser.page.live`,
`browser.screen` и `browser.lives.changed` (−24, −10 и 6). Снимки Under the hood и подсветки потока данных пересняты.

**Tokens.** Автор: около 230 тыс. токенов контекста за первый раунд и около 40 тыс. за доработку (точного счётчика у
агента нет; оценка по объёму прочитанного и написанного). Проверка: по оценке ревьюера.
