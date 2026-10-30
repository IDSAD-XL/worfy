# 04 — Страница Terminal: Terminal и Terminal AI

Type: task
Status: claimed 2026-10-30T21:37Z
Blocked by: 01
Source: «Как устроено» и Q18 [spec.md](../spec.md); решения владельца 2026-10-30, Q2, Q3, Q7, Q9, Q10, Q20, Q21, Q22; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- Описания этих Feature в репозитории нет. После Ticket-а 01 `docs/features/terminal.md` и
  `docs/features/ru/terminal.md` — заготовки в одну строку.
- Пилот: страница проверяет несколько Feature на одной странице и заметные отличия Windows.
- SSH session не описывается: Epic `worfy-terminal-ssh` на 0 из 10, этого Feature нет в `main`.

## Что делаем

1. Читает код и test-ы из свежего `origin/main`. Это источник страницы (Q7). Ticket-ы и ADR нужны только
   для «почему так» и как подсказка, где искать.
2. Пишет `docs/features/terminal.md` на английском, по разделу на каждый Feature:
- Terminal.
- Terminal AI.
3. В каждом разделе — три блока шаблона: **Behaviour** (без путей), **How it works** («почему так» — одна-две
   фразы и ссылка на ADR), **Implementation** (модули и точки входа с путями, поток данных, главные test-ы;
   без номеров строк и без копий сигнатур). Отличия платформ — подзаголовком внутри нужного блока. Скриншотов
   нет. Только настоящее: без changelog и без пересказа ADR. Пути — в форме из индекса
   `docs/features/README.md`.
4. Утверждение, которое не подтверждается кодом или test-ом, на страницу не попадает. Оно уходит в раздел
   `## Итог` этого Ticket-а (Q20). Запускать приложение не нужно, платных запросов к Claude нет.
5. Страница вышла больше примерно 400 строк — делит её на две и пишет об этом в `## Итог`, таблица spec-а и
   индекс правятся отдельным PR (Q9).
6. Пишет `docs/features/ru/terminal.md`: перевод с шапкой `> Перевод [английской версии](../terminal.md), commit `same-pr`.`
   под заголовком. Термины и названия UI остаются на английском.
7. Индекс не правит (Q22).

## Готово, когда

- [ ] Обе страницы в `main`, заготовки заменены, разделы соответствуют списку или отличия объяснены в
      `## Итог`.
- [ ] Страница на английском, это не ошибка: для `docs/features/` действует исключение ADR-0088.
- [ ] Review: один агент уровня `low` сверяет каждое утверждение с кодом и проверяет, что на странице нет
      номеров строк. Merge блокирует только неверное утверждение (Q21; исключение из правила о PR только с
      документами, раздел «Исключения» spec-а). Отчёт review называет уровень и потраченные токены.
- [ ] `ci-ok` зелёный. Gate full не нужен: код не меняется.
- [ ] `## Итог` называет утверждения, которые не подтвердились. Токены на страницу записывает Orchestrator
      при закрытии Ticket-а, не implementer.

## Тесты

Новых test-ов нет. Проверка путей Ticket-а 02 читает английскую страницу.

## Где в коде

Папки выведены из имён, код при составлении Ticket-а не читался. Автор проверяет список при claim и дополняет:

- `src/main/terminal`
- `src/shared/terminal`
- `src/main/terminal-ai`
- `src/shared/terminal-ai`

Добавлено при claim (код только читался, правки в нём нет):

- `src/main/ipc/terminal.ts`, `src/main/ipc/terminal-ai*.ts`, `src/shared/ipc/terminal*.ts`
- `src/renderer/canvas/nodes/TerminalNode.tsx`, `src/renderer/canvas/nodes/terminal-*.ts`, `src/renderer/canvas/nodes/TerminalAiRequest.tsx`,
  `src/renderer/canvas/ReadOnlyTerminal.tsx`
- `src/renderer/settings/TerminalAiSection.tsx`, `src/renderer/settings/useTerminalAi.ts`, `src/renderer/shell/ProjectSettings.tsx`
- `src/renderer/platform.ts`, `src/renderer/shortcuts/match.ts`, `src/shared/shortcuts.ts`, `src/renderer/canvas/wheel-router.ts`
- `src/main/ipc/projects.ts`, `src/renderer/shell/FirstRunChecks.tsx` («Sign in with gh»)

Добавлено в rework, раунд 1 (код только читался):

- `src/main/github/accounts.ts`, `src/renderer/projects/GithubAccount.tsx` («Sign in with gh»)
- `src/main/agent/env.ts` (окружение на Windows)

## Вне скоупа

- Исправление найденных багов продукта: такая находка — в `## Итог`.
- Feature, которых нет в `main`.

## Итог

Страница написана: `docs/features/terminal.md` и перевод `docs/features/ru/terminal.md`, по 360 строк с небольшим, делить её не
пришлось. Разделы соответствуют списку. Приложение не запускалось, платных запросов к Claude не было.

**Не вошло на страницу: код или test не подтверждают.**

1. Задержки ответов модели (Haiku без thinking, медиана ~1,3 с; Sonnet 1,4–3,8 с). Источник — только spike в ADR-0058, это замер
   2026-10-09, кодом и test-ами не проверяется.
2. Запускаются ли hooks встроенных plugin-ов Claude Code в assist-процессе. Код только пишет в log те, что запустились; есть ли они,
   из кода не видно.
3. Что запущенное через `open` приложение macOS остаётся жить после закрытия Terminal-а. Это комментарий в `pty.ts`, test-а нет.
4. Замеры Windows из комментариев кода: консоль задерживает вывод на 3 секунды без ответа на запрос атрибутов, запрашивает позицию
   курсора около десяти раз после resize, скорость разбора у worker-ов. На страницу вошло только то, что main отвечает и что делает,
   без этих чисел.
5. Что PowerShell записывает историю после каждой команды. Это комментарий, test-а нет. На странице только SIGHUP и история у Git Bash.
6. Копирование и вставка клавишами в Terminal-е. Своего кода у worfy нет, это поведение xterm.js и меню Electron, test-а в этих файлах не
   нашёл. На странице только то, что вставленное идёт как ввод.

**Находки в коде (не исправлял, уровень low).**

- `ASSIST_SYSTEM_PROMPT` в `src/main/terminal-ai/options.ts` говорит модели «zsh prompt on macOS» на любой системе. На Linux с zsh это
  неверно. Сборки под Linux нет (в `electron-builder.yml` только `mac` и `win`), поэтому сейчас на поведение не влияет.
- Раздел Settings «Terminal AI» показан и на Windows, где ни одна функция работать не может: shell там никогда не zsh. Страница пишет это как
  факт, текст раздела говорит только «Works in zsh Terminals.»
- Вне скоупа Ticket-а: комментарий в `src/renderer/canvas/nodes/TerminalNode.tsx` над компонентом говорит, что ⌘I в Terminal-е без
  панели идёт в shell. Это неточно: ⌘I остаётся у xterm.js и shell не получает ничего. Та же неточность в комментарии
  `test/unit/terminal-ai-request.test.tsx` («⌘I goes to the shell again»).
- Заметка «Terminal AI is off» в таблице отказов на практике редкая: при выключенном Command request строка `# …` просто запускается как
  обычная, а панели нет. Заметка возможна только при гонке с изменением настройки.

**Вопросы пилота к владельцу.**

- **Linux.** Код различает «Windows» и «не Windows», и test-ы идут на Linux в CI, но пакета под Linux нет. Страница называет только macOS и
  Windows. Если Linux считать поддерживаемым, блоки «On macOS» надо расширить.
- **Группировка подошла:** две Feature на одной странице читаются нормально. Но код Terminal AI лежит и в `src/main/terminal/zsh/rc.d`, так что
  таблицы Implementation у разделов частично ссылаются на одну папку.
- **Шаблон подошёл,** подзаголовок Windows внутри блока работает. Спорное место: в How it works у Terminal AI оказалась таблица моделей и предел
  времени. Это и принцип, и деталь реализации; оставил там, потому что выбор модели — решение ADR-0058.
- **Числа в Behaviour.** На странице есть конкретные значения (600 мс, 800 мс, 80 %, 256 КБ, 20 команд, 50 строк). Все они подтверждены кодом, но
  устаревают при правке констант, а проверка путей этого не заметит. Заметит только линза `documentation` или аудит.

