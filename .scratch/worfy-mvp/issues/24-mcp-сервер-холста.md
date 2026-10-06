# 24 — MCP-сервер холста: агент меняет Раскладку только через tools, Карточку пишет файлом

Type: task
Status: done — 2026-10-05, [PR #16](https://github.com/IDSAD-XL/worfy/pull/16)
Blocked by: 05, 07, 10
Source: [ADR-0003](../../../docs/adr/0003-cards-as-files-canvas-via-tools.md); [CONTEXT.md](../../../CONTEXT.md), «Карточка», «Раскладка»

## Что делаем

Каждая Сессия worfy получает встроенный MCP-сервер `worfy-canvas` (`createSdkMcpServer` из SDK,
в том же процессе). Это публичный контракт между агентом и приложением: меняется осознанно и
вместе с инструкцией агенту.

- Tools (схемы — `src/shared/canvas/tools.ts`, zod):
  - `list_nodes` — Узлы Проекта: id, тип, заголовок, положение, размер, скрыт ли, `locked`.
    Привязок в ответе нет: их считает тикет 16, и этот тикет от него не зависит;
  - `create_card` — заводит Карточку: id, папку `<папка Проекта>/cards/<id>/` и путь
    `index.html`, который агент потом пишет обычным Write; Узел ставится рядом с Узлом
    вызвавшей Сессии, если место не задано;
  - `create_note` — текстовый Узел;
  - `update_node` — заголовок и данные Карточки или заметки;
  - `move_node`, `resize_node`, `hide_node` (и обратно);
  - `link_card` — связь Карточки с Эпиком или Тикетом (`<эпик>` или `<эпик>/<NN>`); цель
    проверяется по модели workflow из тикета 10, несуществующий Эпик или Тикет — ошибка tool-а.
- Каждый вызов идёт той же операцией в `src/main/layout/store.ts`, что и от renderer-а, и
  проверяется: неизвестный Узел, чужой Проект, размер вне пределов — понятная ошибка tool-а, а
  не исключение. Удалять Узлы агент не может вовсе; Узлы с `locked` (Оркестратор, HANDOFF,
  Тикеты, рамки Эпиков) он ещё и не скрывает — только сдвигает и меняет размер.
- Сервер подключается в `src/main/agent/options.ts`. Папка Карточек Проекта добавляется в
  `additionalDirectories`, чтобы агент мог писать туда файлы.
- Инструкция агенту (`agent-instructions.md`) добавляется к системному промпту (`append` к preset
  `claude_code`): где лежат Карточки, что Карточка — один самодостаточный HTML с JS, без Node и
  скриптов-генераторов, сеть только https, API Карточки (ссылка на тикет 26), список tools и
  правило «Раскладку — только tools, не файлы». Коротко: это не руководство по стилю.
- Какая Сессия последней правила Карточку, main выводит сам, а не из слов агента: чистая функция
  `src/shared/cards/last-editor.ts` идёт по событиям `tool_use` Сессий worfy (07) и берёт
  последнее, чей `input.file_path` после нормализации лежит внутри папки Карточки
  `<папка Проекта>/cards/<id>/`. Результат хранится в данных Узла, чтобы пережить перезапуск;
  нужен тикету 26.

## Готово, когда

- [x] Contract test-ы на каждый tool: валидный вызов меняет Раскладку и рассылает её; невалидный возвращает ошибку tool-а с текстом.
- [x] Попытка удалить или скрыть Оркестратор отклоняется.
- [x] Вызовы tool-ов и перетаскивание в renderer одновременно не ломают `layout.json` (тот же test, что в 05, с tool-ами).
- [x] Инструкция агенту попадает в системный промпт (fake-агент записывает опции).
- [x] `link_card` на несуществующий Тикет возвращает ошибку tool-а.
- [x] Последняя правившая Сессия: Сессия A пишет `cards/c1/index.html`, потом Сессия B правит `cards/c1/app.js`, Сессия C пишет вне папки и через `cards/c1/../c2/` — итог B (contract test).
- [x] Ручной прогон с настоящим SDK на репозитории worfy: «сделай карточку с часами» — агент вызывает `create_card`, пишет файл, Узел появляется (содержимое покажет 25); снимок в «Итог».

## Тесты

- `test/contract/canvas-tools.test.ts` — все tools через экземпляр сервера в процессе (новый).
- `test/contract/card-last-editor.test.ts` — события `tool_use` fake-агента → последняя правившая Сессия: Write, Edit, MultiEdit, относительный путь, `..`, путь вне папки (новый).
- Сначала падающий test: `move_node` для несуществующего Узла возвращает ошибку tool-а.

## Где в коде

- `src/main/mcp/canvas-server.ts`
- `src/shared/canvas/tools.ts`
- `src/shared/cards/last-editor.ts`
- `src/main/mcp/agent-instructions.md`
- `src/main/agent/options.ts`

## Итог

Сделано в ветке `worfy-mvp/24`. Сервер `worfy-canvas` — `src/main/mcp/canvas-server.ts`, схемы
tools — `src/shared/canvas/tools.ts`, последняя правившая Сессия — `src/shared/cards/last-editor.ts`,
инструкция агенту — `src/main/mcp/agent-instructions.md`, подключение — `src/main/agent/options.ts`.

Первый test (`move_node` для несуществующего Узла, `test/contract/canvas-tools.test.ts`) на базе
без реализации падает на импорте: `Error: Cannot find module '/src/shared/canvas/tools'`,
`Test Files 1 failed`, exit code 1. В первом круге это не было записано, а коммит в ветке один,
так что падение воспроизведено в круге доработки: test-файл ветки скопирован в чистый
`origin/main` (b2248b6) и запущен `vitest run … -t "move_node for a Node that is not there"`.

### Решения, которых нет в тексте тикета

- **Подключение идёт через `src/main/ipc/agent.ts`, файл вне следа.** `sessionOptions()` — чистая
  сборка опций, Проекта Сессии она не знает. Сервер привязан к Проекту, поэтому его создаёт
  `sdkQueryFactory` (через `canvasForSession`) и передаёт в `sessionOptions({ canvas })`. Правка
  в `ipc/agent.ts` — 20 строк: резолвер холста параметром с умолчанием, сбой холста оставляет
  Сессию без tools холста, а не без Сессии. Fake-агент (`WORFY_AGENT=fake`) холста не получает.
- **Опции записывает подменённый `query()` SDK, а не fake-агент.** Fake-агент опций не получает:
  `fakeQueryFactory` строится до опций (`fake-query.ts` вне следа). Test «инструкция в системном
  промпте» (`test/contract/canvas-tools.test.ts`, «canvas in a Session») вызывает настоящий
  `sdkQueryFactory` с настоящим `createSdkMcpServer` и подменой только `query()`, которая
  записывает опции.
- **Проект Сессии — по cwd.** Проект, чей корень равен cwd или содержит его (worktree
  `.claude/worktrees/NN` внутри репозитория — тот же Проект), сравнение по realpath и по границе
  папки (`/x/worfy-old` не внутри `/x/worfy`). Из вложенных Проектов берётся самый глубокий. Если
  ни один корень cwd не содержит, cwd разрешается через git так же, как при добавлении Проекта
  (`src/main/projects/store.ts`): у linked worktree общий `.git` — `<корень>/.git`, поэтому
  worktree вне папки репозитория (`../repo-feature`) — тот же Проект. Список Проектов после
  вызова git читается заново. cwd вне Проектов — Сессия без сервера, без
  `additionalDirectories` и с голым preset. Ограничение: отдельный git-репозиторий внутри папки
  Проекта, который сам не добавлен Проектом, получает холст объемлющего Проекта — по пути его
  не отличить, а git вызывается только когда путь ничего не дал.
- **Сервер добавляется к MCP-серверам пользователя**, а не заменяет их: `strictMcpConfig` не
  ставится, `settingSources` прежние. `alwaysLoad` не ставится: tools холста откладываются за
  ToolSearch, как остальные MCP-tools (риск размера контекста из 06). Инструкция в системном
  промпте называет tools, и агент находит их сам (ручной прогон ниже: `ToolSearch` →
  `create_card`). Описания tools — 8 строк; test ограничивает `tools/list` 6000 символами.
- **Узел Карточки:** `kind: 'card'`, id Узла = id Карточки = имя папки `cards/<id>/`
  (`card-<8 hex>`, годится как метка hostname для `worfy-card://<id>.<ключ>/` из 25). В `data` —
  `title`, `links` (`[{epic, num|null}]`, `num: null` — связь с Эпиком), `lastEditor` (SDK id
  Сессии). Путей в `data` нет: папка выводится из id. Заметка — `kind: 'note'`, `data.text`, как
  в 05.
- **Границы tools строже схемы Раскладки:** размер 40…4000, координаты ±100 000. Проверку делает
  и сервер MCP (своя zod-проверка до вызова), и `canvasToolCaller` (повторный разбор тех же
  shapes): лишние ключи отбрасываются, неверный тип — ошибка tool-а с именем поля.
- **`update_node`** меняет только `title` Карточки и `text` заметки. Другие Узлы (Оркестратор
  и т. д.) и чужие поля — ошибка: агент не может переписать, например, `sessionId` Оркестратора.
- **`hide_node`** скрывает и показывает (`hidden=false`); скрыть `locked` нельзя, показать можно.
  Удаления нет ни в одном tool; вызов несуществующего `delete_node` — ошибка tool-а.
- **`link_card`** проверяет цель по `readCheckout` (`epic-status --json` по checkout Проекта, без
  веток worktree): Тикет считается существующим, если он есть в checkout. Ошибка чтения workflow —
  ошибка tool-а с текстом. `remove=true` снимает связь без проверки цели.
- **Куда ставится новый Узел без x/y.** Справа от Узла, у которого `data.sessionId` равен SDK id
  вызвавшей Сессии, и ниже, пока не перестанет пересекаться с видимыми Узлами; если такого Узла
  нет — справа от всех видимых. SDK id сервер узнаёт из `system/init` Сессии (обёртка над query,
  тот же разбор `sdkMessageToEvents` и то же правило, что у `Session` в
  `src/main/agent/session.ts`), до первого init — из `resume`. `session_id` других сообщений id
  не меняет. Ключ `data.sessionId` — тот, что тикет 08
  описывает для Узла Оркестратора; если 08 назовёт его иначе, правится одна строка в `place()`.
- **Последняя правившая Сессия** считается по `tool_use` Write, Edit, MultiEdit, NotebookEdit
  (`notebook_path`). Read не считается. Запись через Bash (`cat > …`) не видна — это не
  `file_path`. Симлинки не раскрываются: функция чистая, путь сравнивается после нормализации
  `.`, `..`, `//` и относительного пути от cwd Сессии. Учитывается момент `tool_use`, а не
  успешный `tool_result`: неудачная запись тоже считается правкой. Результат пишется в `data`
  Узла через `patchData` того же LayoutStore и переживает перезапуск вместе с `layout.json`;
  запись в папку Карточки без Узла ничего не меняет.

- **Запись последнего редактора остаётся на обёртке query, а не на `EventSink` Сессии.** Ревью
  предложило подавать в запись события `tool_use` через `EventSink` в `ipc/agent.ts` и брать SDK
  id у `Session`. Это перенесло бы создание холста из фабрики query в `agentStart` и потребовало
  бы передать id `Session` в фабрику (`QueryRequest`, `src/main/agent/session.ts` — вне следа);
  в последнем круге доработки цена — новая гонка между перезапуском query после ошибки и
  сменой id. Сделано меньшее: один разбор сообщения на событие и одно правило смены id (init).
  Следствие, которое остаётся: с `WORFY_AGENT=fake` холста нет, и запись последнего редактора
  через fake-агента в e2e не проверить; её проверяют contract test-ы с fake-агентом,
  обёрнутым так же, как настоящий (`test/contract/card-last-editor.test.ts`).

### Ручной прогон с настоящим SDK

SDK 0.3.289, Claude Code 2.1.289, macOS arm64, вход по подписке. Прогон повторён в круге
доработки, чтобы Проект был заведён так, как его заводит приложение. Скрипт — вне репозитория
(scratchpad): временный `WORFY_DATA_DIR`; Проект добавлен настоящим `projectStore().add()` с
папкой отдельного worktree `.claude/worktrees/24-manual` (detached, `origin/worfy-mvp/24`), и
`add()` завёл корень репозитория — `/Users/alexey/Stuff/CanvasForAI`, id `CanvasForAI-a2cd477b`.
Сессия — `SessionRegistry` с теми же `canvasForSession()`, `agentEnv()` и `sessionOptions()`,
cwd — тот worktree, так что Проект найден по правилу «worktree внутри репозитория». Отличия от
приложения — ради цены, как во втором прогоне 07: `model: 'haiku'`, `strictMcpConfig: true` (без
MCP-серверов пользователя), `maxTurns: 12`. Сообщение: «Сделай карточку с часами». Ход — из
транскрипта Сессии `579c36de-6bb7-4784-9e9c-09ddf1559648`:

```
projects.json {"projects":[{"id":"CanvasForAI-a2cd477b","name":"CanvasForAI","path":"/Users/alexey/Stuff/CanvasForAI"}],…}
model claude-haiku-4-5-20251001
tool_use ToolSearch {"query":"select:mcp__worfy-canvas__create_card","max_results":1}
tool_use mcp__worfy-canvas__create_card {"title":"Часы","w":300,"h":300}
tool_result ok {"id":"card-5c34574f","kind":"card","title":"Часы","x":0,"y":0,"w":300,"h":300,…,"folder":".../data/CanvasForAI-a2cd477b/cards/card-5c34574f",…}
tool_use Write {"file_path":".../data/CanvasForAI-a2cd477b/cards/card-5c34574f/index.html", …}
tool_result ok "File created successfully at: …/cards/card-5c34574f/index.html"
layout.json {"nodes":[{"id":"card-5c34574f","kind":"card","x":0,"y":0,"w":300,"h":300,…,"data":{"title":"Часы","lastEditor":"579c36de-6bb7-4784-9e9c-09ddf1559648"}}],…}
card folder card-5c34574f [ 'index.html' ] (4045 байт)
```

После прогона `git status --porcelain --ignored` worktree-а пуст, `git status` основного checkout
тот же, что до прогона: в репозиторий ничего не записано.

Снимок — [`.scratch/worfy-mvp/evidence/24-canvas-card.png`](../evidence/24-canvas-card.png):
собранное приложение (`pnpm build`, Playwright `_electron`, `page.screenshot()`, копия того же
`WORFY_DATA_DIR`). На Холсте Проекта CanvasForAI один Узел `card-5c34574f` 300×300 в (0, 0) с
заглушкой «Unknown node: card»: Узел появился в окне, его содержимое покажет 25.

Проверено 2026-10-06 ночью: прогон на модели пользователя (`claude-opus-5-5[1m]`) с его
MCP-серверами из Session view собранного приложения, ход стоил $0.1041 — подраздел
[«Ручная проверка 2026-10-06, ночь»](#ручная-проверка-2026-10-06-ночь).

### Ручная проверка 2026-10-06, ночь

Сборка `main` @ 92c00a5, проверял агент. Режим Б: собранный `worfy.app`, запущенный через
LaunchServices с окружением launchd, настоящий Claude Code с входом владельца. Orchestrator на
`claude-opus-5-5[1m]` в режиме bypass, с MCP-серверами владельца. Снимки лежат в scratchpad Session оркестратора, в репозиторий не положены.

**Card с часами на модели владельца — проверено (проверка 25 гайда).**

- Сообщение «сделай карточку с часами». В транскрипте: ToolSearch
  `select:mcp__worfy-canvas__create_card`, затем `create_card {title:"Часы", w:320, h:380}` → id
  `card-dfacfbc3`, затем Write в `…/cards/card-dfacfbc3/index.html` (2428 байт). Ход — 20 с.
- Cost Orchestrator-а $0.8171 → $0.9212: ход стоил $0.1041 (ход без tools в Ticket-е 33 — $0.2118). 634
  tools отложены через ToolSearch, около 60k токенов из кэша на запрос. «Prompt is too long» и chip
  error не было.
- ⌘K → «Часы · Card · Go to» → Return: Node с циферблатом, время идёт (Ticket 25, тот же подраздел).
  `git status --short` основного checkout пуст до и после.
- Попутно: `create_card` без x/y поставил Card в (440,460) поверх рамки Epic-а `worfy-daily` — рамка,
  свёрнутый Epic `worfy-mvp` и угол Ticket-а 09 рисуются поверх часов. Это долг размещения из «Итог»
  Ticket-а 11, его исправляет Ticket 10 `worfy-daily`.
- Снимки: `25-02-turn-transcript.png`, `25-03-palette-chasy.png`, `25-04-goto-card.png`,
  `25-05-card-t1.png`, `25-06-card-t2.png`.
