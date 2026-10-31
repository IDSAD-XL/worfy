# 0043 — qmd — часть Harness: установка через npm, обёртки и MCP-сервер в plugin, модели с согласия, коллекции по Profile
Дата: 2026-10-07. Статус: принят.

**Контекст.** qmd — локальный поиск по markdown-документам (ADR, урокам, Ticket-ам, памяти
Claude), которым агенты Harness ищут прошлые решения и уроки до начала работы. ADR-0021 ставит
MCP-сервер `qmd` в список серверов по умолчанию (`DEFAULT_MCP_SERVERS`,
`src/main/workflow/profile.ts:25`). Определение Harness в `CONTEXT.md` исключает из Harness личные
skills и MCP-серверы пользователя, и qmd оказался на границе: рекомендация к Session
проектирования Epic-а E3 `worfy-harness` («Harness как часть worfy») была — необязательная
зависимость. Владелец 2026-10-07 решил иначе (вопрос Q5, против рекомендации), а вопросы Q15 и
Q16 той же Session решили, как qmd ставится и что индексирует.

Факты на 2026-10-07:

- qmd 2.8.3 ставится командой `npm install -g @tobilu/qmd`, лицензия MIT, нужен node ≥ 22.
- Модели qmd скачиваются с HuggingFace при первом использовании: у владельца в
  `~/.cache/qmd/models` 3,4 ГБ, upstream по умолчанию — около 2 ГБ.
- Индекс — `~/.cache/qmd/index.sqlite`, список коллекций — `~/.config/qmd/index.yml`.
- У владельца qmd обёрнут скриптами `~/.claude/bin/qmd-mcp`, `qmd-refresh`, `qmd-sync-main`.
  Запись MCP-сервера qmd лежит в `~/.claude.json` и запускает `~/.claude/bin/qmd-mcp`; hook Stop
  вызывает `qmd-refresh --quiet`.
- Upstream предлагает и свой plugin `qmd@qmd`.
- Инструменты MCP-сервера, которого регистрирует plugin, называются
  `mcp__plugin_<plugin>_<server>__<tool>` (документация plugins-reference).
- Profile уже несёт `qmd.collections` (где ждать ответа по Project-у) и `qmd.fallback_grep` (где
  искать grep-ом, если qmd молчит). У Profile worfy `qmd.collections` пуст: репозиторий worfy в
  индекс не добавлен.
- Список MCP-серверов worfy передаёт Session-ам как `managedSettings.allowedMcpServers`
  (`src/main/agent/options.ts:118`). Каким именем в этом списке назвать сервер qmd, когда его
  регистрирует plugin, не проверено; это проверяет Ticket 01 Epic-а (spike; итог — ADR-0048).

**Решение.**

1. **qmd — часть Harness (Q5).** worfy ставит qmd, скачивает модели и строит индекс. Остальные
   личные skills и MCP-серверы пользователя в Harness по-прежнему не входят. Определение Harness
   в `CONTEXT.md` меняется так же: qmd в Harness входит.
2. **Установка (Q15)** — `npm install -g @tobilu/qmd` на node пользователя: node ≥ 22 и так нужен
   скриптам Harness. Сам node worfy не ставит — показывает команду `brew install` (первый запуск,
   Ticket 19).
3. **Обёртки и MCP-сервер — в plugin `worfy`.** `qmd-mcp`, `qmd-refresh` и `qmd-sync-main`
   переезжают в plugin. MCP-сервер qmd регистрирует сам plugin (`.mcp.json`). Запись qmd в
   `~/.claude.json` при переносе убирается, иначе у пользователя будет два сервера qmd (перенос —
   ADR-0047, Ticket 14). Инструменты в agents Harness называются `mcp__plugin_worfy_qmd__…`.
4. **Модели — с согласия.** Скачивание моделей предлагает первый экран, с размером. Его можно
   пропустить: тогда агенты ищут grep-ом по `qmd.fallback_grep`. Модель для русского текста
   ставится, только если `language.docs` Profile-а — `ru` (ADR-0044).
5. **Коллекции по Profile (Q16).** При подключении Project-а Harness заводит коллекции qmd по его
   Profile: документы (ADR, `CONTEXT.md`, HANDOFF, уроки), Ticket-ы и память Claude по
   Project-у. Источник коллекций зависит от режима (ADR-0042): в Full mode — отдельная копия
   main, как сегодня делает `qmd-sync-main`; в Silent mode — Workflow folder (папка с файлами
   workflow вне git). Список коллекций хранится в Profile, индекс — на машине. worfy получает
   свои коллекции сразу; коллекции Auction переносятся как есть.
6. **Запись вне папки данных worfy.** Установка qmd пишет в глобальные пакеты npm пользователя, в
   `~/.cache/qmd/` и в `~/.config/qmd/`. Как и установка plugin (ADR-0040, пункт 7), она идёт
   только после подтверждения пользователя. Test-ы — в песочнице с временным `HOME`.
7. **Дополнение (worfy-windows Ticket 15, 2026-10-31): порог node и `update:` на Windows.** `engines` пакета qmd
   обещает node 22, но его `better-sqlite3` собран под N-API 10: нужен node 22.14 или новее, на линии 23 — 23.6 или новее,
   ниже процесс умирает при загрузке модуля без вывода. Порог проверяют обёртки и экран первого запуска, contract-тест
   держит их одинаковыми. Обёртки на Node (ADR-0055). qmd исполняет строку `update:` как `bash -c <строка>` на всех системах,
   поэтому на Windows она идёт через Git Bash: обёртки ставят в начало PATH для qmd свой node и Git Bash. `qmd update`, набранный
   руками, может попасть в `bash.exe` из WSL; руками запускают `qmd-refresh --force --wait`.

**Что меняется в прежних ADR.**

- ADR-0019 (Harness — plugin): «личные MCP-серверы пользователя в Harness не входят и не
  трогаются» — кроме qmd: его запись в `~/.claude.json` перенос убирает.
- ADR-0021 (MCP-серверы по списку в Profile): `qmd` в списке по умолчанию теперь — сервер plugin
  `worfy`. Имя, под которым он стоит в `mcp.allowed` и `allowedMcpServers`, фиксирует ADR-0048.

**Последствия.**

- У нового пользователя поиск по решениям и урокам работает с первого подключённого Project-а,
  без ручной настройки qmd.
- Первый запуск предлагает скачать около 2 ГБ моделей и требует сети для npm и HuggingFace.
  Без согласия qmd не работает, и агенты ищут grep-ом.
- Команда установки версию qmd не фиксирует: npm ставит ту, что опубликована на момент
  установки. Закреплять ли версию, решает Ticket 17 (qmd в Harness).
- Agents Harness меняют имена инструментов с `mcp__qmd__…` на `mcp__plugin_worfy_qmd__…`
  (Ticket-ы 07 и 17). В старых транскриптах остаются старые имена.
- Запись hook Stop с `qmd-refresh` в `settings.json` владельца ведёт в обёртку, которая уходит в
  plugin, поэтому перенос её убирает. Где после переноса вызывается обновление индекса, решает
  Ticket 17.
- Если пользователь поставит ещё и upstream plugin `qmd@qmd`, у него окажется второй сервер qmd;
  это решение такой случай не разбирает.

## Considered Options

- **qmd — часть Harness: npm, обёртки и `.mcp.json` в plugin, модели с согласия, коллекции по
  Profile** (выбрано).
- **qmd — необязательная зависимость** (рекомендация к Session проектирования): Harness работает и без него,
  skills и agents ищут grep-ом по `qmd.fallback_grep`. Отвергнуто владельцем (Q5): qmd стоит в
  списке MCP-серверов по умолчанию (ADR-0021), и без установки новый пользователь остаётся только
  с grep-ом.
- **Upstream plugin `qmd@qmd` как зависимость plugin `worfy`.** Отвергнуто (Q15): версию и имя
  сервера задавал бы чужой plugin, а не версия worfy (ADR-0019), и обёртки Harness
  (`qmd-sync-main`, коллекции по Profile) всё равно нужны.
- **qmd внутри `.app`.** Отвергнуто (Q15): путь меняется вместе с `.app` (тот же довод, что против
  plugin прямо из `.app`, ADR-0040), а qmd нужен и Session-ам в терминале.
