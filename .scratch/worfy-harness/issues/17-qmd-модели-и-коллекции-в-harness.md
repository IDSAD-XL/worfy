# 17 — qmd ставится вместе с Harness: npm, модели с согласия, коллекции по Profile

Type: task
Status: done 2026-10-08
PR: #145
Blocked by: 16
Source: решения владельца 2026-10-07, вопросы Q5, Q15 и Q16 ([spec.md](../spec.md)); [ADR-0043](../../../docs/adr/0043-qmd-is-part-of-harness.md) — qmd часть Harness; [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) — папка plugin и состояние машины в `~/.claude/worfy-harness/`; ADR-0048 (будет `docs/adr/0048-harness-plugin-spike-results.md`) — итог spike Ticket-а 01 (имя MCP-сервера plugin в `allowedMcpServers`; файл заводит Ticket 01)

## Что происходит

qmd — локальный поиск по markdown (ADR, HANDOFF, Ticket-ы, память Claude); агенты зовут его через
MCP-сервер. Сейчас он стоит только на машине владельца и собран руками.

- **Установка.** `qmd` 2.8.3 стоит глобально на node из nvm
  (`~/.nvm/versions/node/v24.19.0/bin/qmd`). Модели — 3,4 ГБ в `~/.cache/qmd/models`, индекс —
  `~/.cache/qmd/index.sqlite`, коллекции — `~/.config/qmd/index.yml`. Ставит и обновляет это
  только владелец.
- **MCP-сервер записан в `~/.claude.json`** (`mcpServers.qmd`, command
  `/Users/alexey/.claude/bin/qmd-mcp`), а не в plugin. В форме переноса (Ticket 14, шаг владельца —
  Ticket 16) эта запись стоит в списке «уберу» (Q19). Исполнитель на момент взятия проверяет
  `jq '.mcpServers.qmd' ~/.claude.json` (только чтение). Если записи уже нет, то до этого Ticket-а у
  агентов нет qmd, и они ищут grep-ом по `qmd.fallback_grep` Profile.
- **Обёртки** (после Ticket-а 02 — `harness/bin/`, исходник — `~/.claude/bin/`):
  - `qmd-mcp` задаёт модели жёстко: embed — строка 9, русская модель расширения запроса — строка 11.
    Ищет `qmd` через nvm (`:14-17`), в фоне обновляет индекс и запускает `qmd mcp` (`:54`).
    Согласия на скачивание моделей нет: qmd сам качает их при первом запросе.
  - `qmd-refresh` зовёт Stop-hook (`~/.claude/settings.json:71`, `qmd-refresh --quiet`). Путь к
    `qmd-sync-main` по умолчанию — `$HOME/.claude/bin/qmd-sync-main` (`qmd-refresh:35`).
  - `qmd-sync-main` подтягивает git-копию main. Путь к `profile` по умолчанию —
    `$HOME/.claude/bin/profile` (`:29`). Путь копии — `~/.cache/qmd/<profile>-<branch>` (`:56`), его
    переопределяет `qmd.mirror.path`. Само клонирование копии не делает ни один скрипт:
    `qmd-refresh` только пишет «копии нет».
  - Пути и состояние скриптов в `~/.claude/worfy-harness/` (`HARNESS_HOME`) переводит Ticket 08.
    Проверить по `harness/bin/` на момент взятия.
- **Коллекции владельца** (`~/.config/qmd/index.yml`):
  - `auction` и `tickets` — копия `~/.cache/qmd/auction-main` с
    `update: /Users/alexey/.claude/bin/qmd-sync-main auction` (строки 5 и 15);
  - `memory` — память Claude по Auction;
  - `lessons` — уроки Profile atakama.

  У worfy коллекций нет: в Profile `qmd.collections: []`.
- **Имена инструментов.** `~/.claude/agents/scout.md:4` и `reviewer.md:4` перечисляют
  `mcp__qmd__query`, `mcp__qmd__get`, `mcp__qmd__multi_get`, `mcp__qmd__status`. У `implementer.md`
  строки `tools` нет: он получает все инструменты. Инструмент MCP-сервера из plugin называется
  `mcp__plugin_<plugin>_<server>__<tool>` ([docs plugin-ов Claude Code](https://code.claude.com/docs/en/plugins-reference)).
- **worfy.** Список MCP-серверов Session по умолчанию — `['qmd', 'worfy-canvas']`
  (`src/main/workflow/profile.ts:25`). Он уходит в `managedSettings.allowedMcpServers`
  (`src/main/agent/options.ts:118`) и отсекает все серверы не из списка, серверы plugin-ов тоже.
  Сервер qmd из plugin под другим именем в Session worfy не попадёт.
- `qmd --help` (2.8.3): `pull` качает модели, `collection add|list|remove` правит коллекции,
  `update` переиндексирует, `embed` строит векторы. `search` (BM25) работает без моделей.

## Что делаем

1. **MCP-сервер в plugin** (Q15).
   - `harness/.mcp.json` объявляет сервер `qmd` с командой `${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp`.
   - Строки `tools` в `scout.md` и `reviewer.md`: `mcp__plugin_worfy_qmd__query`, `__get`,
     `__multi_get`, `__status`.
   - В worfy в `DEFAULT_MCP_SERVERS` вместо `qmd` встаёт имя сервера plugin. Какое именно — по
     ADR-0048.
   - Старый сервер `qmd` из `~/.claude.json` в Session worfy больше не попадает: его отсекает тот же
     список. Так в Session worfy не бывает двух qmd. Двух qmd в терминале не бывает, если запись
     убрана формой Ticket-а 14; этот Ticket её не трогает.
2. **Установка через npm с согласия** (Q15). Новый модуль main `src/main/harness/qmd.ts`.
   - **Состояние:** есть ли `qmd` в PATH login shell (ADR-0007) и какой версии; node ≥ 22; есть ли
     модели; что пользователь ответил про модели.
   - **`installQmd`** запускает `npm install -g @tobilu/qmd@<QMD_VERSION>` в окружении login shell
     (`src/main/agent/env.ts`). Отдаёт код выхода и последнюю строку stderr. Без явного согласия в
     вызове не делает ничего.
   - **Версия закреплена.** ADR-0043 оставил этот выбор Ticket-у 17. `QMD_VERSION` — константа в
     коде, сейчас `2.8.3`. Почему закреплена: обёртки опираются на поведение этой версии.
     `qmd-refresh` сам разбирает `index.yml`. `qmd-mcp:10` пишет, что 2.8.3 не читает модель
     `generate` из `index.yml`. Новая версия qmd приходит PR-ом в `harness/` вместе с проверкой
     обёрток. qmd с другой версией в PATH — проверка показывает `warn` с версией. Сама собой
     переустановка не идёт.
   - **node.** Нет node или версия ниже 22 — npm не зовётся. Ответ — ошибка с `brew install node`
     (Q22: системное worfy не ставит).
   - Кнопки и подтверждение рисует экран первого запуска (Ticket 19). Здесь — только модуль.
3. **Модели — с размером и согласием** (Q15).
   - **Размер.** До согласия модуль отдаёт список моделей и их размер. Размер — из таблицы в коде.
     Исполнитель меряет файлы в `~/.cache/qmd/models` (только `ls -l`) и пишет цифры в «Итог». Для
     сверки: у владельца 3,4 ГБ, по умолчанию у upstream около 2 ГБ.
   - **Какие модели.** Русская модель расширения запроса входит в список, только если у
     какого-нибудь Project `language.docs` = `ru`. Иначе — модель qmd по умолчанию.
   - **Согласие** запускает `qmd pull` с теми же переменными моделей, что у `qmd-mcp`.
   - **Ответ** «скачано» или «пропущено» пишется в `~/.claude/worfy-harness/`. Имя файла выбирает
     исполнитель.
   - **Без «скачано» сервер не стартует.** `qmd-mcp` выходит с ненулевым кодом и одной строкой в
     stderr, `qmd mcp` не запускается. Иначе qmd скачал бы модели сам, без согласия.
   - **Пропуск.** Агенты остаются без qmd и ищут grep-ом по `qmd.fallback_grep` (правило уже есть
     в skills).
4. **Модель по языку Project** (Q15). `qmd-mcp` до `cd "$HOME"` читает
   `profile --field language.docs` по каталогу Session. Русскую модель расширения он задаёт только
   при `ru`. Модели embed и rerank — как сейчас.
5. **Коллекции по Profile** (Q16). Новый скрипт `harness/bin/qmd-collections <project>` на node, как
   `profile`.
   - **Три коллекции:**
     - документы — каталог ADR, CONTEXT, HANDOFF и уроки, из полей `docs.*` и `lessons` Profile;
     - Ticket-ы — `.scratch/` в Workflow folder;
     - память Claude по Project — `<CLAUDE_CONFIG_DIR или ~/.claude>/projects/<путь Project, где
       «/» и «.» заменены на «-»>/memory`, как в `~/.claude/projects/-Users-alexey-Stuff-CanvasForAI`.
   - **Источник:**
     - Full mode — git-копия main (`~/.cache/qmd/<project>-<branch>`, как в `qmd-sync-main`). Копии
       нет — скрипт клонирует её с токеном `github.account`, как это делает `qmd-sync-main`, не
       переключая глобальный `gh`. У коллекции — `update: <папка plugin>/bin/qmd-sync-main <project>`.
     - Silent mode — Workflow folder, без `update:`. Такие коллекции `qmd-refresh` уже считает
       локальными.
   - **Имена** — `<project>-docs`, `<project>-tickets`, `<project>-memory`. Это выбор этого
     Ticket-а: имя коллекции одно на всю машину.
   - **Запись.** Имена ложатся в `qmd.collections`, описание — в `qmd.covers` Profile на машине
     (`~/.claude/worfy-harness/projects/<project>/profile.json`, Q11'). Потом идёт `qmd update`. При
     согласии на модели — ещё `qmd embed` в фоне, как в `qmd-refresh`.
   - **Повторный запуск** ничего не меняет.
   - **Чужая коллекция.** Коллекция с тем же именем и другим путём — отказ, код ≠ 0, `index.yml` не
     меняется.
   - **Коллекции уже есть.** Profile уже называет коллекции, и они есть в `index.yml` (Auction:
     `auction`, `tickets`, `memory`). Тогда новые не заводятся — правится только путь `update:`
     (пункт 6).
   - **Репозиторий Project** скрипт не пишет никогда.
   - **Кто зовёт.** Ticket 24 — при подключении Project. Для уже подключённых Project-ов (worfy,
     Auction) — шаг qmd экрана первого запуска (Ticket 19), через `src/main/harness/qmd.ts`. Так
     worfy получает свои коллекции сразу (Q16).
6. **Старые пути `update:`.** Коллекции, чей `update:` зовёт `qmd-sync-main` не из plugin, получают
   путь `~/.claude/worfy-harness/plugin/bin/qmd-sync-main <profile>`. Сейчас это
   `/Users/alexey/.claude/bin/qmd-sync-main auction`.
   - Перед правкой — копия `index.yml` рядом с датой в имени.
   - Имена, пути и `pattern` коллекций Auction не меняются: переносятся как есть (Q16).
7. **Hook и скрипты.** Stop-hook `qmd-refresh --quiet` живёт в `harness/hooks/hooks.json`; если
   Ticket 05 его не перенёс — добавить. `qmd-refresh` и `qmd-sync-main` находят `qmd-sync-main` и
   `profile` рядом с собой (`$(dirname "$0")`), а не в `~/.claude/bin` — если Ticket 08 этого не
   сделал.
8. **skill `qmd`** (`harness/skills/qmd/SKILL.md`): где индекс, кто заводит коллекции, что с
   моделями и согласием, что делать, если сервера нет. Блок с таблицей коллекций проверяет
   `harness/bin/tests/skill-blocks.test.sh` — держать его зелёным.
9. **Контракт Profile.** В `profiles/README.md`:
   - `qmd.collections` теперь заполняет Harness;
   - поле `qmd.mirror.path|branch` читает `qmd-sync-main:53-56`, но в README его нет — дописать.

ADR не нужен: решения — в ADR-0043, имя сервера — в ADR-0048.

**Не входит:** экран и кнопки (Ticket 19); подключение Project (Ticket 24); удаление записи qmd из
`~/.claude.json` (Ticket 14).

## Готово, когда

Всё, что пишет в `~/.claude`, `~/.config/qmd` или `~/.cache/qmd`, проверяется в песочнице:
временные `HOME` и `CLAUDE_CONFIG_DIR`, для npm — ещё `npm_config_prefix`. Настоящие папки
владельца test-ы не трогают.

- [ ] `harness/.mcp.json` объявляет сервер `qmd` с командой `${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp`. У `scout` и `reviewer` в `tools` — `mcp__plugin_worfy_qmd__query`, `__get`, `__multi_get`, `__status`. `grep -rn 'mcp__qmd__' harness/` — код выхода 1. Проверяет `harness/bin/tests/qmd.test.sh`.
- [ ] Session worfy в Project без `mcp.allowed` получает в `allowedMcpServers` имя сервера по ADR-0048 и `worfy-canvas`, без `qmd`. Unit-test `test/unit/agent-options.test.ts` и contract test `test/contract/workflow-profile.test.ts`.
- [ ] Contract test `test/contract/harness-qmd.test.ts`, подменённый `npm` пишет свои аргументы. Без согласия `npm` не зовётся. С согласием зовётся ровно `install -g @tobilu/qmd@2.8.3` (значение `QMD_VERSION`) в окружении login shell. qmd другой версии в PATH — `warn` с версией, `npm` сам не зовётся. Код ≠ 0 у npm — ошибка с кодом и строкой stderr, без повтора. node 20 или нет node — `npm` не зовётся, ошибка с `brew install node`.
- [ ] Тот же test: размер моделей — сумма из таблицы. Русская модель в списке только при `language.docs: ru` хотя бы у одного Profile. `qmd pull` (подменённый `qmd`) — только после согласия. Пропуск пишет «пропущено».
- [ ] `harness/bin/tests/qmd.test.sh`, `qmd-mcp`:
  - ответ «пропущено» или нет ответа → код ≠ 0, строка в stderr, подменённый `qmd` не получил `mcp`;
  - ответ «скачано» → `qmd mcp` запущен;
  - русская модель в env — только при `language.docs: ru` по каталогу Session.
- [ ] `harness/bin/tests/qmd-collections.test.sh`, `origin` — локальный bare-репозиторий:
  - Full mode: копия склонирована; три коллекции с путями и `update:` на `qmd-sync-main` из plugin; имена в Profile;
  - Silent mode: пути в Workflow folder, без `update:`;
  - второй запуск: `index.yml` и Profile побайтно те же;
  - чужая коллекция с тем же именем → код ≠ 0, `index.yml` не изменён;
  - Profile как у Auction → поменялся только `update:`, рядом копия;
  - `git status --porcelain` репозитория Project пуст во всех случаях.
- [ ] (песочница, локально, не в CI) Каждая команда — код 0:
  - настоящий `npm install -g @tobilu/qmd@2.8.3` во временный `npm_config_prefix`;
  - `qmd-collections` на временном клоне worfy в Full mode;
  - `qmd update`;
  - `qmd search` находит файл ADR-0043 — BM25, без моделей.

  Команды и коды выхода — в «Итог».
- [ ] Время изменения `~/.config/qmd/index.yml` и `~/.claude.json` владельца до и после прогона всех test-ов совпадает (`stat -f %m`).
- [ ] (вручную, песочница после `/login` владельца, Q8) Session `claude` с plugin в песочнице видит сервер qmd plugin-а, и `mcp__plugin_worfy_qmd__status` отвечает.

Ручной пункт агент закрывает, только если в песочнице уже есть вход. Вход делает владелец.
Если входа нет — в «Итог» строка «не проверено: …», в HANDOFF — пункт в разделе «Ждёт владельца».

## Тесты

Сначала падающий test: `test/unit/agent-options.test.ts`. Session в Project без `mcp.allowed`
ждёт в `allowedMcpServers` имя сервера plugin. На main там `qmd` (`profile.ts:25`), и test красный.
Как он падал — в «Итог».

- `test/contract/harness-qmd.test.ts` — новый: установка, модели, согласие, node.
- `harness/bin/tests/qmd-collections.test.sh` — новый: коллекции по Profile.
- `harness/bin/tests/qmd.test.sh` — `qmd-mcp` без согласия, выбор модели, `.mcp.json`, имена
  инструментов.
- `harness/bin/tests/skill-blocks.test.sh` — блок skill `qmd` после правки.
- `test/contract/workflow-profile.test.ts`, `test/unit/agent-options.test.ts` — список серверов.

test-ы `harness/bin/tests/` идут в CI worfy на Linux (Ticket 02). `qmd-mcp` и `qmd-refresh` написаны
на zsh и зовут `stat -f`. Если CI на Linux их не тянет, test, которому нужен macOS, пропускается
по платформе, и это записано в «Итог».

## Где в коде

- `harness/.mcp.json` — новый
- `harness/bin/qmd-mcp` (исходник — `~/.claude/bin/qmd-mcp`)
- `harness/bin/qmd-refresh` (исходник — `~/.claude/bin/qmd-refresh`)
- `harness/bin/qmd-sync-main` (исходник — `~/.claude/bin/qmd-sync-main`)
- `harness/bin/qmd-collections` — новый
- `harness/bin/tests/qmd.test.sh` (исходник — `~/.claude/bin/tests/qmd.test.sh`)
- `harness/bin/tests/qmd-collections.test.sh` — новый
- `harness/bin/tests/skill-blocks.test.sh` (исходник — `~/.claude/bin/tests/skill-blocks.test.sh`)
- `harness/hooks/hooks.json` (завёл Ticket 05; исходник записи — `~/.claude/settings.json:71`)
- `harness/agents/scout.md` (исходник — `~/.claude/agents/scout.md`)
- `harness/agents/reviewer.md` (исходник — `~/.claude/agents/reviewer.md`)
- `harness/skills/qmd/SKILL.md` (исходник — `~/.claude/skills/qmd/SKILL.md`)
- `harness/profiles/README.md` (исходник — `~/.claude/profiles/README.md`; если Ticket 11 положил
  контракт в другое место — там)
- `src/main/harness/qmd.ts` — новый. Если Ticket 13 завёл для кода установщика другую папку —
  файл ложится рядом с ним, путь — в «Итог».
- `src/main/workflow/profile.ts`
- `src/main/agent/options.ts` — добавлен по ходу работы с согласия оркестратора: схему ADR-0048, пункт 4 (сервер plugin-а регистрирует worfy) не делал ни один Ticket
- `test/contract/harness-qmd.test.ts` — новый
- `test/unit/agent-query-factory.test.ts`, `test/contract/harness-migrate.test.ts`, `harness/bin/tests/agents-text.test.sh`, `harness/hooks/tests/rules-hooks.test.sh` — добавлены по ходу работы: эти test-ы фиксировали прежнее поведение (plugin без `skipMcpDiscovery`, plugin без `.mcp.json`, старые имена инструментов qmd, Stop-hook без `qmd-refresh`)
- `test/contract/workflow-profile.test.ts`
- `test/unit/agent-options.test.ts`

Общие файлы с соседями после Ticket-а 16:
- `harness/agents/reviewer.md` — Ticket 18;
- `harness/hooks/hooks.json` — Ticket 18 (и Ticket 22, только если он добавит hook `WorktreeCreate`);
- `harness/profiles/README.md` — Ticket-ы 18 и 22;
- `harness/bin/tests/skill-blocks.test.sh` — Ticket 22.

В одной Wave такие Ticket-ы идут последовательно. Profile на машине этот Ticket меняет только в
поле `qmd`.

## Итог

Сделано в ветке `worfy-harness/17`.

- **Сервер qmd в plugin.** `harness/.mcp.json` объявляет сервер `qmd` с командой
  `${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp`. У `scout` и `reviewer` в `tools` —
  `mcp__plugin_worfy_qmd__query`, `__get`, `__multi_get`, `__status`; `grep -rn 'mcp__qmd__' harness/` — код
  выхода 1. Stop-hook `qmd-refresh --quiet` Ticket 05 не перенёс — добавлен в `harness/hooks/hooks.json`
  (timeout 15, как в старом `settings.json`).
- **Session-ы worfy (ADR-0048, пункт 4) — схема сделана здесь**, потому что больше её никто не делал;
  решено без владельца, подтверждено владельцем 2026-10-12. Inline plugin идёт с `skipMcpDiscovery: true`, а серверы его
  `.mcp.json` worfy регистрирует сам как `plugin_worfy_<сервер>` (`src/main/agent/options.ts`,
  `pluginMcpServers`), с `${CLAUDE_PLUGIN_ROOT}`, заменённым на путь inline plugin-а, и только если имя
  пропускает список MCP-серверов Profile. Нечитаемый или битый `.mcp.json` — Session стартует без этих
  серверов, причина уходит в `console.warn`. `DEFAULT_MCP_SERVERS` — `['plugin_worfy_qmd', 'worfy-canvas']`.
  При старом Harness (`legacy`, plugin не передаётся) сервера `plugin_worfy_qmd` нет, а `qmd`
  пользователя список по умолчанию больше не пропускает.
- **Падающий test первым:** `test/unit/agent-options.test.ts`, «with the default list, gets the plugin qmd
  and worfy-canvas…» упал на main так: ожидалось `allowedMcpServers: [{serverName: 'plugin_worfy_qmd'},
  {serverName: 'worfy-canvas'}]`, пришло `[{serverName: 'qmd'}, …]`.
- **Модуль установки** — `src/main/harness/qmd.ts` (рядом с установщиком Ticket-а 13,
  `src/main/harness/install.ts`). `qmdState`, `installQmd` (`npm install -g @tobilu/qmd@2.8.3`, только с
  `consent: true`), `answerModels` (`qmd pull` с переменными `qmd-mcp` или «пропущено»),
  `setupCollections` (зовёт `bin/qmd-collections`). `QMD_VERSION = '2.8.3'`.
- **Файл ответа про модели** — `~/.claude/worfy-harness/qmd-models`: первая строка `downloaded` или
  `skipped`, дальше URI моделей, которые сообщил `qmd pull`. Без `downloaded` `qmd-mcp` выходит с кодом
  3 и одной строкой в stderr, `qmd-refresh` делает `qmd update`, но не `qmd embed`.
- **Размеры моделей** (`ls -l ~/.cache/qmd/models` владельца, 2026-10-08):
  - embed `Qwen3-Embedding-0.6B-Q8_0` — 639 150 592 байт;
  - rerank `qwen3-reranker-0.6b-q8_0` — 639 153 184 байт;
  - русская модель расширения `qmd-query-expansion-ru-q4_k_m` — 1 107 409 152 байт;
  - модель расширения qmd по умолчанию `qmd-query-expansion-1.7B-q4_k_m` — 1 282 438 912 байт.

  С русской моделью — 2 385 712 928 байт (2,2 ГиБ), без неё — 2 560 742 688 байт (2,4 ГиБ). У владельца
  3,4 ГиБ, потому что лежат обе модели расширения. Upstream по умолчанию берёт embed
  `embeddinggemma-300M` (меньше), Harness — Qwen3 0.6B, как `qmd-mcp` раньше.
- **Найдено в песочнице:** первая команда qmd на машине записывает в `index.yml` раздел `models:` с теми
  моделями, что получились из окружения или умолчаний, и дальше он сильнее переменных окружения. Поэтому
  `qmd-collections` и `qmd-refresh` зовут qmd с моделью embed от `qmd-mcp`, а файл ответа хранит то, что
  реально скачал `qmd pull`; `qmd-mcp` выбирает модель расширения только из скачанных.
- **Коллекции:** `harness/bin/qmd-collections <project>` — `<project>-docs`, `<project>-tickets`,
  `<project>-memory`; Full mode — копия main (клонирует, если её нет), Silent mode — Workflow folder
  (`workflow.folder`, по умолчанию `~/.claude/worfy-harness/projects/<project>/workflow`). Папка памяти —
  путь Project, где каждый символ кроме буквы и цифры заменён на `-` (так Claude Code называет и
  `Application Support` → `Application-Support`).
- **Песочница, локально** (`HOME`, `HARNESS_HOME`, `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`,
  `XDG_CACHE_HOME`, `npm_config_prefix`, `npm_config_cache` — во временной папке), каждая команда — код 0:
  - `npm install -g @tobilu/qmd@2.8.3` во временный `npm_config_prefix` — EXIT=0, `qmd 2.8.3 (facd35e)`;
  - `qmd-collections worfy` на временном клоне worfy в Full mode — EXIT=0; копия склонирована, три
    коллекции, имена в Profile песочницы; второй запуск — EXIT=0, `index.yml` и Profile побайтно те же;
  - `qmd update` — EXIT=0;
  - `qmd search "qmd часть Harness"` — EXIT=0, первым `qmd://worfy-docs/docs/adr/0043-qmd-is-part-of-harness.md`;
  - моделей в песочнице не скачано (`qmd pull` не запускался).
- **Linux CI:** test-ы `harness/bin/tests/qmd*.test.sh` идут под zsh; `stat -f` в `qmd-mcp` и `qmd-refresh`
  они не задевают, пропуска по платформе нет.
- **mtime** `~/.config/qmd/index.yml` до и после всех прогонов — 1791161777. `~/.claude.json` меняется
  во время работы и без test-ов: 1791428067 в брифе, 1791428111 до первой команды этого Ticket-а.
- **не проверено:** Session `claude` с plugin в песочнице после `/login` (ручной пункт): входа в
  песочнице нет. Живую Session worfy с `plugin_worfy_qmd` тоже не запускали. Обе проверки — за владельцем.
- **Ждёт владельца** (Profile и `index.yml` на машине этот Ticket не менял):
  1. обновить plugin в `~/.claude/worfy-harness/plugin` сборкой с этим Ticket-ом;
  2. записать согласие на модели. Модели у владельца уже скачаны, поэтому `qmd pull` только сверит их:
     `QMD_EMBED_MODEL=hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf QMD_GENERATE_MODEL=hf:AGmind/qmd-query-expansion-ru/qmd-query-expansion-ru-q4_k_m.gguf qmd pull`,
     затем файл `~/.claude/worfy-harness/qmd-models` с первой строкой `downloaded` и URI из вывода `qmd pull`
     (позже это делает экран первого запуска, Ticket 19);
  3. `~/.claude/worfy-harness/plugin/bin/qmd-collections worfy` — коллекции worfy;
  4. `~/.claude/worfy-harness/plugin/bin/qmd-collections auction` — путь `update:` коллекций `auction` и
     `tickets` с `/Users/alexey/.claude/bin/qmd-sync-main` (после Ticket-а 16 его нет) на plugin, копия
     `index.yml` рядом.

  Сделано; прочитано на машине 2026-10-12: plugin — `0.2.0+4d3d60c`, первая строка `qmd-models` — `downloaded`,
  коллекции worfy есть в Profile, путь `update:` у `auction` ведёт в `worfy-harness/plugin/bin/qmd-sync-main`.

Гейт волны 8: `VERIFIED` с первого круга (PR #145, влит `282a7c9`). Выход за след — `src/main/agent/options.ts`
(регистрация серверов plugin-а под `plugin_worfy_<name>` по ADR-0048 п.4) — разрешил оркестратор, «решено без
владельца, подтвердить». Долги ревьюера (не блокируют):
- [low] `harness/bin/tests/qmd-collections.test.sh:51` — `collect()` не очищает `QMD_INDEX_YML`, `QMD_CONFIG_DIR`,
  `XDG_CONFIG_HOME` (их первыми читает `harness/bin/qmd-collections:57-59`). Запуск test-а напрямую с одной из них
  в окружении пишет тестовые коллекции в настоящий `index.yml`. CI не задет: обёртка
  `test/contract/harness-scripts.test.ts:50` даёт минимальное окружение.
- [low] `harness/bin/tests/qmd-collections.test.sh:15` — `BIN` через `pwd`, не `pwd -P`: под путём-ссылкой
  (`/tmp` → `/private/tmp`) проверка «full: index.yml» краснеет на верном коде.
