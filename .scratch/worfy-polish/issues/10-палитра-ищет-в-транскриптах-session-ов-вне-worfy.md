# 10 — Палитра ищет текст и в транскриптах Session-ов, запущенных вне worfy

Type: task
Status: done 2026-10-15
PR: #355
Blocked by: —
Source: [spec.md](../spec.md), кандидат U3; «Итог» [`worfy-mvp` 31](../../worfy-mvp/issues/31-палитра-и-поиск.md):
«Не сделано: транскрипты Сессий, запущенных вне worfy (их события читает `useSessionTranscript` в
`useClaudeHome.ts`, хранилище не экспортировано), в поиск не входят — только Сессии worfy, чьи события
есть в окне»; [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md).

## Что происходит

- Поиск ⌘F по Canvas (`src/renderer/find/CanvasFind.tsx`) берёт транскрипты только Session-ов, чьи
  события есть в окне: `findDocs` (`src/renderer/find/search-index.ts:340-343`) читает `transcripts`
  из `useSessionLogs` (`CanvasFind.tsx:320`, `:332`) — это Session-ы worfy.
- Палитра ⌘K знает Session-ы только как Узлы Canvas и находит их по заголовку
  (`src/renderer/palette/commands.ts:79-81`, `:292`).
- Session-ы, запущенные в терминале или в Claude Desktop, worfy видит (`claudeHome.sessions` —
  `live` и `history`, `src/shared/ipc/claude-home.ts:71-76`) и открывает в Session view
  (`ExternalSessionPanel.tsx`), но найти «ту Session, где обсуждали X» по тексту нельзя.

## Что делаем

1. **Поиск в main** — `src/main/claude-home/search.ts`: по запросу (не короче 3 символов) — транскрипты
   Session-ов Project-а (те же, что в `history` и `live` `claudeHome.sessions`), от новых к старым. Текст —
   то же, что видит Session view: сообщения пользователя и ответы Claude из `parse.ts`, без вызовов tool и
   их вывода. Без учёта регистра. Предел: не больше 200 файлов и 64 МБ чтения на запрос, не больше
   20 найденных Session-ов; ответ говорит, был ли упор в предел.
2. **Канал** `claudeHome.search` (scope `project`, как соседние) в `src/shared/ipc/claude-home.ts`,
   обработчик — в `src/main/ipc/claude-home.ts`. Ответ: `sessionId`, заголовок, время, отрывок вокруг
   первого совпадения (до 120 символов) — без путей файлов.
3. **Палитра.** Группа `In transcripts` в `CommandPalette.tsx`: запрос из поля палитры уходит в
   `claudeHome.search` через 250 ms после последнего ввода; пока ответа нет — строка «Searching…»;
   устаревший ответ (запрос уже другой) отбрасывается. Выбор строки открывает Session в Session view, как
   выбор её в History (`openSession`, `src/renderer/session/navigation.ts:31`).
4. Session-ы worfy, которые уже ищет ⌘F, в группе тоже есть: это поиск по Project-у, а не по окну.
5. **Только чтение**: ничего не пишется ни в `~/.claude`, ни в папку данных worfy; кэш индекса — в
   памяти main, сбрасывается по `claudeHome.changed`.

## Готово, когда

- [x] Contract test: временный `WORFY_CLAUDE_HOME` с тремя транскриптами Project-а и одним чужого
      Project-а; запрос находит только свои, без учёта регистра, с отрывком; вызовы tool не ищутся.
- [x] Contract test: предел файлов — ответ с флагом упора; дерево `WORFY_CLAUDE_HOME` до и после поиска
      совпадает.
- [x] Unit test палитры: ввод → один вызов `claudeHome.search` после паузы; ответ на старый запрос не
      показывается; выбор строки зовёт `openSession` с `sessionId`.
- [x] Новый канал — в списке каналов test-ов, которые их перечисляют (`claude-home-registry.test.ts` и
      проверка scope каналов Linked machine, если она перечисляет каналы).
- [ ] (вручную; не проверено: шаг владельца на Stable copy после влития) Stable copy: Session, запущенная в Terminal.app в папке Project-а, находится в палитре
      по слову из своего ответа и открывается.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/contract/claude-home-search.test.ts` — новый.
- `test/unit/palette-transcripts.test.tsx` — новый; `invoke` — mock.
- Сначала красный: contract test «запрос находит Session по тексту ответа» (канала нет).
- Мутанты: искать и в выводе tool; не отбрасывать устаревший ответ; читать транскрипты чужого
  Project-а; без предела файлов. Каждый краснит свой test.

## Где в коде

- `src/main/claude-home/search.ts`
- `src/main/ipc/claude-home.ts`
- `src/shared/ipc/claude-home.ts`
- `src/renderer/palette/CommandPalette.tsx`
- `test/contract/claude-home-search.test.ts`
- `test/unit/palette-transcripts.test.tsx`
- `test/contract/claude-home-registry.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/main/claude-home/registry.ts`, `src/shared/transcript/parse.ts`,
`src/renderer/claude-home/useClaudeHome.ts`, `src/renderer/session/navigation.ts`,
`src/renderer/find/search-index.ts`, `test/contract/link-access.test.ts`.

## Вне скоупа

- Поиск ⌘F по Canvas: он про Узлы окна и остаётся как есть.
- Транскрипты Subagent-ов и workflow-скриптов.
- Полнотекстовый индекс на диске.

## Риски

- **Большие транскрипты.** Предел на запрос (пункт 1) держит время ответа; замер на настоящем
  `~/.claude` владельца (только чтение, временная копия не нужна — поиск ничего не пишет) — в «Итог»:
  сколько файлов, МБ и мс.
- **Секреты в транскриптах.** Отрывок показывается только в окне этой Machine; в журналы и логи он не
  пишется.

## Итог

- **Поиск в main** — `src/main/claude-home/search.ts`, класс `TranscriptSearch`. Список Session-ов
  берётся из `ClaudeHomeRegistry.sessions` (то же `history`, что видит History, от новых к старым),
  путь файла — из папок `transcriptDirs` Project-а. Ищется текст событий `text` (ответы Claude) и
  `notice` вида `user` (сообщения пользователя) из `parse.ts`, только основной поток; вызовы tool, их
  вывод, thinking, hook-и и записи Subagent-ов не ищутся. Без учёта регистра (`RegExp` с флагами `iu`
  по буквальному запросу). Пределы — 200 файлов, 64 МБ, 20 Session-ов; флаг `limited` в ответе.
- **Канал** `claudeHome.search` (scope `project`): вход `projectRoot` и `query` (3–200 символов после
  trim), ответ `hits[]` — `sessionId`, `title`, `at` (mtime файла, мс), `snippet` (до 120 символов, с
  `…` на обрезах) — и `limited`. Пути файлов в ответе нет. Вызов Linked machine проходит ту же проверку
  «корень внутри Project-ов», что соседние каналы.
- **Палитра** — группа `In transcripts` после групп команд: запрос уходит через 250 ms после
  последнего ввода, пока ответа нет — «Searching…»; ответ на старый запрос отбрасывается (и при позднем
  приходе, и при раннем); упор в предел — строка «Older transcripts were not searched», ошибка —
  «Could not search the transcripts: …». Выбор строки — `openSession` с `external: { sessionId }`, как у
  Session из реестра; ↑/↓ и Enter доходят до этих строк. Строка показывает отрывок с места совпадения,
  весь отрывок — в tooltip.
- **Только чтение**: contract test сравнивает дерево временного Claude home до и после поиска.
- Снимки (Playwright на собранном приложении, временные HOME и Claude home): палитра с двумя
  найденными Session-ами в светлой и тёмной теме и открытая Session — в scratchpad
  `/tmp/worfy-pol-w1/impl-10/screens/`, в репозиторий не кладутся.

Решено без владельца, подтвердить:

- **Кэш** текста транскриптов — в памяти main (до 32 млн символов), но не сбрасывается по
  `claudeHome.changed`, а сверяется с размером и mtime файла при каждом поиске: изменённый файл
  читается заново. Так кэш верен и без открытого watcher-а (вызов Linked machine, окно без подписки).
- **Транскрипт больше оставшегося бюджета** (например, один файл больше 64 МБ) пропускается целиком,
  поиск идёт дальше по следующим, ответ — `limited: true`.
- **Session worfy** из результатов открывается в Session view как транскрипт из файла (только
  чтение), а не на своём Узле, даже если Узел есть.
- Время (`at`) в строке палитры не показывается: строка и так узкая.

Не сделано: замер на настоящем `~/.claude` владельца (файлы, МБ, мс) — бриф Wave запретил агенту
`~/.claude`; замер — шаг владельца или оркестратора.

### Gate оркестратора (2026-10-15)

- Wave Epic-а под Autopilot: Ticket-ы 01–05, 07–11 параллельно, общих файлов в «Где в коде» нет; 06 и 12 в команду не входили. Worktree — `.claude/worktrees/pol-<NN>`: пути `04`, `10`, `11` заняты деревьями других Epic-ов. Нагрузку CPU (`yes > /dev/null`) по своему «Готово, когда» дают 04 и 05; оркестратор пустил их параллельно с остальными, и timeout-ы под этой нагрузкой краснили gate соседей — ошибка плана, не implementer-ов.
- Гейт — один круг: `VERIFIED` на `0ad2b33` ([комментарий в PR #355](https://github.com/IDSAD-XL/worfy/pull/355#issuecomment-6190868296)). Запущен до merge 09 от `056c32a` (общий `CommandPalette.tsx`), rebase на #353 до финального push. Verifier сам: `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0 (gate fast из кэша); четыре мутанта — все красные; Linked machine проверяется тем же `rootOf`, что и `claudeHome.transcript` — новой утечки нет; запрос экранирован (`search.ts:71`); снимки в обеих темах.
- Мерж: два gate full красные по одному timeout-у 15 s вне diff (`workflow-reader.test.ts`, затем `harness-script-wiring.test.ts`; отдельно — 45/45 и 21/21). Третья попытка: база `d494f60`, head `1cfac91`; `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `338079c`.
- Act on, Dismissed — нет.
- Consider ([low]): `src/main/claude-home/search.ts:127` — каждый поиск зовёт `registry.sessions()` (голова и хвост каждого транскрипта); синтетика 2000 транскриптов, 1,3 GB: поиск 185–340 ms, event loop main стоит до ~100 ms. Вопрос владельцу: вывод bash-режима (`! cat .env`) ищется и попадает в отрывок — так же его показывает Session view. Владелец 2026-10-15: оставить так.
- Noted (**подтверждено владельцем 2026-10-15**): кэш сверяется по размеру и mtime, а не сбрасывается по `claudeHome.changed`; выбранная Session worfy открывается только для чтения; замера на настоящем `~/.claude` нет.
