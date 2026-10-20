# worfy-browser: Browser Node — браузер Chromium на Canvas под сохранённым входом роли

Status: по решению владельца 2026-10-19 (ADR-0078, четыре раунда вопросов, пункты 1–17);
«Готово, когда», файлы Ticket-ов и Wave-ы — предложение этого docs-PR
Source: запрос владельца 2026-10-19;
[ADR-0078](../../docs/adr/0078-browser-node.md) — Browser Node: `<webview>` с хранилищем на Browser
profile, Live и Asleep с пределом, исполнение на Machine Project-а, свой MCP server через CDP; термины
Browser, Browser profile и Family — [CONTEXT.md](../../CONTEXT.md). Ссылки `файл:строка` в Ticket-ах
перечитаны по main `dd6b0afb`. Прежние решения:
[0005](../../docs/adr/0005-worfy-own-state-inventory.md) (состояние worfy — на Machine, не в репозитории),
[0012](../../docs/adr/0012-card-origin-worfy-card-scheme.md) (Card в `<iframe>` на `worfy-card://`),
[0016](../../docs/adr/0016-trash-folder-per-entry-undo-in-renderer.md) (Trash и ⌘Z),
[0021](../../docs/adr/0021-mcp-servers-allowlist-in-profile.md) (список MCP server-ов в Profile),
[0052](../../docs/adr/0052-machines-and-linking.md) (Machine и Linked machine),
[0053](../../docs/adr/0053-several-screens-on-one-project.md) (несколько экранов на Project),
[0066](../../docs/adr/0066-read-only-access-for-a-linked-machine.md) (read-only экран Linked machine),
[0076](../../docs/adr/0076-auto-archive-of-finished-sessions.md) (автоархив Session-ов),
[0077](../../docs/adr/0077-node-kind-tokens.md) (цвет по типу Node-а).
Epic [worfy-canvas](../worfy-canvas/spec.md) — формат и соглашения; его Ticket-ы 03 (Family) и 07
(автоархив) — основа Ticket-а 06.
Ticket-ы: Epic `worfy-browser`, 8 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` /
`Blocked by:` / `Source:` по `harness/bin/TICKETS.md`.

## Откуда

Проекты владельца — чаще всего веб-приложения с ролями: admin, moderator, user. Проверить Ticket
глазами каждой роли сейчас можно только вне worfy: руками в своём браузере или Playwright-тестом,
который знает лишь заранее написанные сценарии. Владелец хочет Node с браузером Chromium на Canvas, в
котором Claude ведёт себя как живой пользователь под сохранённым входом нужной роли, и чтобы висящие
браузеры не ели ресурсы и не тормозили Canvas (ADR-0078, «Контекст»).

Что есть в коде:

- Browser Node нет. В `docs/roadmap.md` среди отложенного — «Dock со встроенным браузером», то есть
  панель вне Canvas, а не Node.
- Card показывается в `<iframe>` на своём origin `worfy-card://` (ADR-0012); постоянного хранилища
  кук у iframe нет.
- `webviewTag` в окне не включён (`src/main/window.ts:84`, блок `webPreferences`); session partition-ов
  (отдельных хранилищ кук и данных сайтов) в `src/main` нет.
- Canvas монтирует только видимые Node-ы (`onlyRenderVisibleElements`,
  `src/renderer/canvas/Canvas.tsx:543`); браузер в Node-е терял бы страницу при каждом pan.
- MCP server-ы Session собираются на запуск Session (`src/main/agent/options.ts`) из встроенного
  `worfy-canvas` и `.mcp.json` Harness, с фильтром по списку в Profile (ADR-0021).
- Terminal и агенты Project-а исполняются на его Machine; Linked machine их только показывает
  (ADR-0052).

## Цель

На Canvas Project-а открывается Browser — сайт или веб-приложение под одним Browser profile. Им
пользуется и сам пользователь, и Session-ы: по просьбе в чате и для проверки Ticket-а глазами нужной
роли. Итог такой проверки — найденные проблемы и Playwright-тесты, которые Session по ним пишет.
Browser-ы, с которыми сейчас не работают, засыпают и не тормозят Canvas.

Epic готов, когда:

1. Слой Live Browser-ов проверен прототипом: pan, zoom, перекрытие Node-ов, drag и обрезка по краю
   рамки; итог — «go» или запасной вариант, записан в Ticket 01 (Ticket 01).
2. Browser открывается из меню Canvas, у него адресная строка, цвет — нейтральный; `<webview>` без
   preload и без `nodeIntegration`, только на partition-ах Browser profile-ов; отдельный e2e-тест
   ловит поломку Browser при обновлении Electron (Ticket 02).
3. Пользователь создаёт и удаляет Browser profile Project-а, сам входит в аккаунт, задаёт список
   origin-ов и флажок «доступен Autopilot»; один Browser profile открыт в нескольких Browser-ах с
   общими куками (Ticket 03).
4. Session через MCP server `worfy-browser` открывает Browser под существующим Browser profile,
   переходит по URL, кликает, печатает, делает screenshot, читает страницу, консоль и сеть; переход вне
   списка origin-ов отклонён с понятной ошибкой; пока Session ведёт, на Browser плашка «Claude
   управляет», клик или ввод пользователя забирает управление (Ticket 04).
5. Browser засыпает и просыпается по правилам ADR-0078, пункт 6; Live одновременно не больше N
   (по умолчанию 3); страница с `beforeunload` не засыпает; пороги и N — в Settings (Ticket 05).
6. Browser, открытый Session-ой, входит в её Family и уходит с Canvas вместе с ней; Browser
   пользователя живёт, пока пользователь его не закроет (Ticket 06).
7. Второе окно и Linked machine видят Browser потоком кадров и передают ему ввод; живая страница одна;
   read-only экран видит только рамку с именем Browser profile (Ticket 07).
8. Агенты Wave проверяют acceptance criteria Ticket-а в Browser под Browser profile-ами с флажком
   «доступен Autopilot»; без нужного входа пишут в отчёт «нужен вход под <роль>» (Ticket 08).

## Решения владельца

2026-10-19, ADR-0078 «Решение», пункты 1–17. Заново не решаются. Ticket-ы ссылаются на номер пункта
ADR («ADR-0078, п. 6»). Коротко:

1. **Зачем** — исследовательская проверка Ticket-а глазами ролей и действия по просьбе в чате;
   регрессионным набором в CI Browser не становится.
2. **Термины** — Browser и Browser profile (`CONTEXT.md`).
3. **Хост — `<webview>`**, у каждого Browser profile своё `partition="persist:…"`; main включает
   `webviewTag` и проверяет каждое подключение в `will-attach-webview`.
4. **Управление — свой MCP server worfy через CDP** (`webContents.debugger`), не Claude in Chrome;
   server входит в список MCP server-ов Profile (ADR-0021).
5. **Browser profile** — у Project-а, на Machine; вход и создание — только пользователь; список
   origin-ов ограничивает Session; один Browser profile — в нескольких Browser-ах.
6. **Live и Asleep** — сон вне экрана ~30 с, на zoom ниже читаемого текста, ~5 мин без фокуса и без
   Session; пробуждение по клику или вызову инструмента; пороги в Settings.
7. **Предел Live** — N = 3 по умолчанию; засыпает тот, к которому дольше всех не обращались; Browser
   под управлением Session не засыпает.
8. **Кто ведёт** — Session открывает Browser под существующим Browser profile; плашка «Claude
   управляет»; перехват пользователем.
9. **Где исполняется** — на Machine Project-а; Linked machine — кадры `Page.startScreencast` и ввод;
   отдельный Ticket после базового Browser.
10. **Autopilot** — только Browser profile-ы с флажком «доступен Autopilot»; «нужен вход под <роль>».
11. **Жизнь после Session** — уходит с ней (автоархив, Hide, Remove); pinned и Keep держат; Restore не
    возвращает; Browser пользователя живёт до закрытия.
12. **Слой Live Browser-ов вне списка Node-ов**; первый Ticket — прототип; запасной вариант — засыпать
    сразу вне экрана и вести только видимый Browser.
13. **Family** — по связи «открыт этой Session»; Browser пользователя ни в какую Family не входит.
14. **Read only** — кадры и ввод Browser — `write`; видна только рамка с именем Browser profile.
15. **Несохранённая форма и занятый предел** — `beforeunload` держит Browser Live с меткой
    «несохранённые изменения»; сверх предела для пользователя — с предупреждением, Session — ошибка
    «все Live Browser-ы заняты».
16. **Одна живая страница на все экраны** — Live в одном окне, остальные — кадры; сон смотрит на все
    экраны.
17. **Не в v1** — `storageState` для Playwright и Dock со встроенным браузером.

## Как устроено

- **Слой и рамка** (ADR-0078, п. 3, 12; Ticket-ы 01, 02). Node Browser в Layout-е — рамка с
  адресной строкой. `<webview>` Live Browser-ов рисуются отдельным слоем внутри той же системы
  координат Canvas (transform viewport-а) и привязаны к своей рамке; `onlyRenderVisibleElements` их
  не размонтирует.
- **Хранилище** (п. 3, 5; Ticket-ы 02, 03). Browser profile — запись Project-а в данных worfy на
  Machine (ADR-0005), его `<webview>` — на `partition="persist:<…>"`. `will-attach-webview` в main
  пропускает только эти partition-ы, без preload и без `nodeIntegration`.
- **Управление** (п. 4, 8; Ticket 04). MCP server `worfy-browser` в main держит CDP-сессию
  (`webContents.debugger`) на `<webview>` и проверяет каждый переход Session по списку origin-ов
  Browser profile. Ввод пользователя в Browser во время управления Session — перехват.
- **Сон** (п. 6, 7, 15; Ticket 05). Решает main: он знает всех Live, все экраны и Session-ы. Asleep —
  screenshot, URL и прокрутка; процесс страницы закрыт.
- **Жизнь и Family** (п. 11, 13; Ticket 06). У Browser, открытого Session-ой, — связь «открыт этой
  Session»; Family (`worfy-canvas` 03) и автоархив (`worfy-canvas` 07) читают её.
- **Другие экраны** (п. 9, 14, 16; Ticket 07). Живая страница — в одном окне на Machine Project-а;
  второе окно и Linked machine получают кадры `Page.screencastFrame` и шлют ввод обратно.
- **Autopilot** (п. 10; Ticket 08). Агенты Wave получают `worfy-browser` и список Browser profile-ов с
  флажком «доступен Autopilot»; это правка Harness plugin-а.

## Не в этом Epic-е

- **Вход Browser profile в Playwright-тесты (`storageState`)** — тесты логинятся сами через fixture-ы
  проекта (ADR-0078, п. 17).
- **Dock со встроенным браузером** — позже он сможет показывать тот же Browser (п. 17).
- **Claude in Chrome и настоящий Chrome** (ADR-0078, «Considered Options»).
- **Вход Claude по учёткам из fixture-ов** — пароли попали бы в транскрипт («Considered Options»).
- **Browser как регрессионный набор в CI** (п. 1).
- **Синхронизация кук между Machine-ами** («Considered Options»).

## Пересечения с другими Epic-ами

Сверка — перед каждой Wave, по открытым PR других Epic-ов. На 2026-10-19:

- **`worfy-canvas` 03** (Family) и **07** (автоархив) влиты (#538, #536). Ticket 06 правит
  `src/renderer/canvas/family.ts` и правило автоархива; если в это время идут Ticket-ы 08–10
  `worfy-canvas` (Settings автоархива, история, toast), кто вливается вторым, перебазируется.
- **`worfy-canvas` 05, 06** (шапка Node-а по типу, semantic zoom) правят `NodeChrome.tsx` и вид Node-ов
  на дальнем zoom. Ticket 02 и 05 читают их результат: Browser — нейтральный тип (ADR-0077).
- **`worfy-windows`**: Ticket-ы 02, 04, 05 и 07 меняют main (окно, CDP, процессы страниц). Платформенные
  ли они — по списку путей ADR-0071, пункт 5, при PR.

## Риски

1. **Слой Live Browser-ов** — главный риск по отображению: страница рисуется над Node-ом, а не внутри
   него; перекрытие, отставание при pan и drag, обрезка по краю (ADR-0078, «Последствия»). Снимает
   прототип Ticket-а 01 до остальной работы.
2. **`webviewTag` — новая поверхность атаки.** Держится на `will-attach-webview` и на том, что guest-
   страница не получает preload worfy. Ticket 02 проверяет каждый запрет test-ом.
3. **Electron не рекомендует `<webview>`** и может менять его между версиями. Отдельный e2e-тест
   Ticket-а 02 идёт при каждом обновлении Electron.
4. **Память.** Каждый Live Browser — отдельный процесс Chromium, ~100–300 МБ; предел N — главный рычаг
   (Ticket 05).
5. **Сон теряет форму**, о которой страница не предупреждает через `beforeunload`; worfy её не видит
   (ADR-0078, «Последствия»).
6. **Session под чужой ролью.** Список origin-ов и вход только руками пользователя — граница, которую
   нельзя ослаблять ради удобства (Ticket-ы 03, 04, 08).
7. **CDP-сессия — только на Machine Project-а.** На Linked machine нет ни кук, ни CDP-сессии (п. 4, 9;
   Ticket 07).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-canvas](../worfy-canvas/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала
падающий test, только чтение чужих файлов, ручные пункты «(вручную)», снимки UI в двух темах
(`snapshotThemes`, `test/e2e/snapshots.ts`), e2e — в своих spec-файлах, мерж — Orchestrator, набором
после `wave-gate` (ADR-0065). Отличия:

- **Начало** — с Ticket-а 01; остальные ждут его итога («go» или запасной вариант).
- **Кто ведёт** — Session на Mac, Wave-ами (`/worfy:epic-wave`).
- **Ветки** — `worfy-browser/<NN>`; worktree — `.claude/worktrees/<NN>`, если путь занят —
  `.claude/worktrees/br-<NN>`.
- **Безопасность.** Ни один Ticket не даёт guest-странице preload, `nodeIntegration` или partition вне
  Browser profile-ов, и не даёт Session ввести пароль за пользователя. Ticket, который трогает
  `will-attach-webview` или проверку origin-ов, держит test на каждый запрет.
- **Внешние сайты в test-ах не открываются.** e2e и contract test-ы ходят на локальный test server
  (fixture-страницы в `test/`), не в интернет.
- **Несколько экранов** (ADR-0053) и **read-only экран** (ADR-0066) — как в `worfy-canvas`: Ticket,
  который меняет Layout или показывает Browser, проверяет два окна одного Project-а и read-only экран.
- **Автоматическое — мимо ⌘Z, жест пользователя — шаг ⌘Z** (ADR-0016).
- **Цвет** — Browser нейтральный (ADR-0077, п. 2); новых ролей `kind-*` нет.
- **ADR.** ADR-0078 — принят. Ticket-у, который найдёт новое решение с признаками ADR, номер выдаёт
  Orchestrator. Решения, которых ADR не принимает, — в разделе «Открытые вопросы» Ticket-а; до claim их
  закрывает владелец или исполнитель записывает выбор в «Итог», как сказано у вопроса.
- **Язык.** Документы — русские, термины — латиницей из `CONTEXT.md`; названия действий UI («Claude
  управляет», «несохранённые изменения» — по ADR) и инструментов MCP — как в Ticket-е; код,
  комментарии, коммиты и PR — английские.

## Порядок

ADR-0078 и термины Browser, Browser profile и правка Family — до Epic-а (этот docs-PR).

- **Фаза 1** — 01 один: прототип слоя решает, как рисуется Browser. Его итог («go» или запасной
  вариант) меняет 02, 04, 05 и 07; при запасном варианте Orchestrator правит их текст до claim.
- **Фаза 2** — 02 после 01.
- **Фаза 3** — 03 после 02.
- **Фаза 4** — 04 после 03 (Session открывает Browser только под Browser profile).
- **Фаза 5** — 05 и 06, оба после 04: 05 правит реестр Live `src/main/browser/live.ts` и server
  `src/main/mcp/browser-server.ts`, которые создаёт 04; 06 — Browser открывает Session.
- **Фаза 6** — 07 после 05 (сон смотрит на все экраны), 08 после 05 и 06 (Browser Autopilot в
  пределе Live и входит в Family Ticket-а).

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/renderer/canvas/nodes/BrowserNode.tsx`, `src/renderer/canvas/overlays/BrowserLayer.tsx`, `src/main/window.ts`, `test/fixtures/browser/`, `test/e2e/browser-layer.spec.ts`, `test/unit/window-options.test.ts` | 1 |
| 02 | `src/renderer/canvas/nodes/BrowserNode.tsx`, `src/renderer/canvas/overlays/BrowserLayer.tsx`, `src/renderer/canvas/nodes/browser-frame.ts`, `src/renderer/canvas/nodes/BrowserNode.css`, `src/renderer/canvas/nodes/CardNode.tsx`, `src/main/window.ts`, `src/main/browser/attach-policy.ts`, `test/unit/webview-attach-policy.test.ts`, `test/unit/window-options.test.ts`, `test/unit/canvas-menu.test.tsx`, `test/e2e/browser.spec.ts`, `test/e2e/browser-webview-guard.spec.ts` | 2 |
| 03 | `src/main/browser/profiles.ts`, `src/main/browser/attach-policy.ts`, `src/shared/ipc/browser.ts`, `src/main/ipc/browser.ts`, `src/renderer/canvas/nodes/BrowserNode.tsx`, `src/renderer/canvas/overlays/BrowserLayer.tsx`, `src/renderer/browser/BrowserProfiles.tsx`, `test/unit/browser-profiles.test.ts`, `test/unit/webview-attach-policy.test.ts`, `test/contract/browser-profiles.test.ts`, `test/e2e/browser-profile.spec.ts` | 3 |
| 04 | `src/main/mcp/browser-server.ts`, `src/main/mcp/browser-instructions.md`, `src/shared/browser/tools.ts`, `src/main/browser/cdp.ts`, `src/main/browser/live.ts`, `src/main/browser/origins.ts`, `src/main/agent/options.ts`, `src/main/agent/app-registry.ts`, `src/shared/ipc/browser.ts`, `src/renderer/canvas/nodes/BrowserNode.tsx`, `test/unit/browser-origins.test.ts`, `test/unit/agent-options.test.ts`, `test/contract/browser-tools.test.ts`, `test/e2e/browser-mcp.spec.ts` | 4 |
| 05 | `src/main/browser/sleep.ts`, `src/main/browser/live.ts`, `src/main/mcp/browser-server.ts`, `src/shared/ipc/browser.ts`, `src/shared/settings/app-settings.ts`, `src/renderer/settings/BrowserSection.tsx`, `src/renderer/canvas/overlays/BrowserLayer.tsx`, `src/renderer/canvas/nodes/BrowserNode.tsx`, `test/unit/browser-sleep.test.ts`, `test/unit/settings-browser.test.tsx`, `test/contract/app-settings.test.ts`, `test/e2e/browser-sleep.spec.ts` | 5 |
| 06 | `src/renderer/canvas/family.ts`, `src/main/layout/store.ts`, `src/main/layout/archive.ts`, `test/unit/family.test.ts`, `test/contract/browser-lifecycle.test.ts`, `test/contract/layout-archive.test.ts`, `test/e2e/browser-family.spec.ts` | 5 |
| 07 | `src/main/browser/owner.ts`, `src/main/browser/screencast.ts`, `src/main/browser/sleep.ts`, `src/shared/ipc/browser.ts`, `src/main/ipc/browser.ts`, `src/renderer/canvas/nodes/BrowserNode.tsx`, `src/renderer/canvas/overlays/BrowserLayer.tsx`, `test/unit/browser-owner.test.ts`, `test/contract/browser-frames.test.ts`, `test/e2e/browser-screens.spec.ts`, `test/e2e/linked-browser.spec.ts` | 6 |
| 08 | `src/main/mcp/browser-server.ts`, `src/main/mcp/browser-instructions.md`, `harness/skills/epic-wave/SKILL.md`, `harness/agents/implementer.md`, `test/contract/browser-tools.test.ts`, `test/e2e/browser-autopilot.spec.ts` | 6 |
| 09 | `src/main/browser/attach-policy.ts`, `test/unit/webview-attach-policy.test.ts`, `test/e2e/browser-webview-guard.spec.ts`, `src/renderer/canvas/canvas.css` | 2 |
| 10 | `src/shared/browser/partition.ts`, `src/renderer/canvas/nodes/BrowserNode.tsx`, `src/renderer/canvas/nodes/BrowserNode.css`, `src/renderer/canvas/overlays/BrowserLayer.tsx`, `src/main/window.ts`, `test/e2e/browser.spec.ts`, `test/unit/window-options.test.ts` | 3 (после ответов владельца) |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01.** Блокеров нет; все остальные ждут его.
- **Wave 2 — 02.** `Blocked by: 01`.
- **Wave 3 — 03.** `Blocked by: 02`.
- **Wave 4 — 04.** `Blocked by: 03`.
- **Wave 5 — 05, 06.** Оба `Blocked by: 04`: 05 правит `live.ts` и `browser-server.ts`, которые
  создаёт 04. Общих файлов нет.
- **Wave 6 — 07, 08.** 07 — `Blocked by: 05`, 08 — `Blocked by: 05, 06`. Общих файлов нет.

Пересечения проверены правилом `filesOverlap` (`src/shared/workflow/waves.ts`) вручную, по таблице.
Если исполнителю нужен файл вне своего списка, он дописывает его в «Где в коде» при claim.
