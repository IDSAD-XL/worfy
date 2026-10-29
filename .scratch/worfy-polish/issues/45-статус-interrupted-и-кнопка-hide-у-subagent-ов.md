# 45 — Старые записи Subagent-ов: статус `interrupted` и кнопка «Hide»

Type: task
Status: open
Blocked by: —
Source: жалоба владельца и его решение 2026-10-29 (принято, ниже). Строки — по main `80149146`.

## Зачем

В панели Subagent-ов у владельца висят записи «running 546h» и старые записи `error`. Убить процессы и
перезапустить worfy не помогает: записи остаются. Сегодня убрать их можно только одним способом —
отправить в архив родительскую Session: архивная Session уносит своё дерево Subagent-ов с собой
(`src/renderer/canvas/sources/subagents.ts:238`). Архивировать рабочую Session ради чистой панели —
неправильный обмен.

## Что происходит

- Статус Subagent-а считает `statusOf` (`src/shared/transcript/subagents.ts:544-553`). Subagent без
  записи о конце остаётся `running`, пока Session считается живой, «however long its file has not
  changed» (комментарий `:540-543`). Если Session закрыта, он становится `error` (`:552`; для записи
  workflow — `:602`; агент закончившегося прогона workflow — `:687`) — это правило ADR-0031 (закрытая
  Session кончает своих Subagent-ов, `docs/adr/0031-closed-session-ends-its-subagents.md`).
- Закрыта ли Session, решает `sessionRuns` (`src/main/claude-home/subagents.ts:140-168`) по папке
  `sessions/` Claude home: `true` — запись называет Session и её процесс жив; `false` — записи нет;
  `null` — «не известно, значит не закрыта» (`:136-138`): transcript не под `projects/` (`:142`), папки
  `sessions/` нет (`:147-148`), запись не читается или проверка процесса вернула `unknown`
  (`:157`, `:165`, `:167`).
- Сигнал `session-closed` добавляется только при `runs === false` (`:271-273`). Значит, при `null` и при
  живом процессе Subagent без конца — `running` навсегда, со счётчиком времени («running 546h»). Живой
  процесс бывает и чужим этому Subagent-у: Session перезапустили (продолжили после выхода из worfy,
  падения, рестарта Session-а) — процесс новый, а Subagent умер вместе со старым.
- ADR-0031 отверг статус `stale` по возрасту файла (`:51-54`) и переход `running` → `done` по тишине файла
  (`:55-56`): живой Subagent может молчать долго. Решение ниже не таймаут по возрасту, а точный признак.
- Убрать запись из панели нельзя. `SubagentNode` (`src/renderer/canvas/nodes/SubagentNode.tsx`) даёт
  только кнопку «Transcript» (`:109-119`, tooltip «Open the transcript of this Subagent» — `:114`) и
  свёртку «N done» (`:151-163`, текст — `:163`). В rail-е (`src/renderer/session/rail/SubagentsRail.tsx`)
  законченные — в группе «Done (N)» (`:91`, `:129-140`), а `error` стоят вместе с `running` в верхнем
  списке (`:92`).
- Таблицы статусов исчерпывающие: `CHIP` в `SubagentNode.tsx:66` и в `SubagentsRail.tsx:24`, тип
  `SubagentStatus` — `src/shared/transcript/subagents.ts:124`, сигналы — схема `:68`.

## Решение владельца (2026-10-29, принято)

Старые записи Subagent-ов убираются двумя путями.

1. **Новый статус `interrupted`.** Subagent без записи о конце, у родительской Session которого текущий
   процесс запущен ПОЗЖЕ последней записи в transcript Subagent-а, умер вместе с прежним процессом (выход
   из worfy, падение, рестарт Session-а). Это точный признак, а не таймаут по возрасту, поэтому он не
   противоречит ADR-0031. Нужен новый короткий ADR.
2. **Кнопка «Hide»** у одной записи Subagent-а и у всей группы законченных (`done` и `error`) — в
   `SubagentNode` и в `SubagentsRail`. Скрытые записи остаются скрытыми после перезапуска worfy.

## Что делаем

1. **ADR.** Новый ADR с номером 0085 — следующий свободный на main 2026-10-29 (последний — 0084; открытые
   PR #958 и #960 правят только 0083). При claim номер проверить заново (`gh pr list --state open --json
   files`). Содержание: статус `interrupted`, его признак, почему это не `stale` из ADR-0031 и почему
   `unknown` остаётся `running`. Ссылка на ADR-0031 в обе стороны.
2. **Признак.** `sessionRuns` при живом процессе отдаёт и время его запуска (`procStart` из записи
   `sessions/<pid>.json`; разбор времени — как в `src/main/claude-home/registry.ts`, на macOS `ps -o
   lstart=`, на Windows FILETIME). `SubagentReader.session` кладёт его новым сигналом рядом с
   `session-closed` (схема `subagentSignalSchema`, `src/shared/transcript/subagents.ts:68`).
3. **Статус.** `SubagentStatus` получает `interrupted`. `statusOf` (и `describeRun` для workflow):
   Subagent без конца, чья последняя запись в transcript раньше запуска текущего процесса Session-а, —
   `interrupted`. Последняя запись позже или равна — `running`, как сейчас. Процесс не известен
   (`sessionRuns` → `null`) — `running`, как сейчас. Session закрыта — `error`, как сейчас (ADR-0031).
4. **UI статуса.** `interrupted` в обеих таблицах `CHIP`, в подписи статуса и в свёртке законченных на
   Canvas и в rail-е: он законченный, как `done` и `error`, renderer его больше не опрашивает. Цвет
   чипа — на выбор исполнителя, снимки в «Итог».
5. **«Hide».** Кнопка у одной записи (Node на Canvas и строка rail-а) и у группы законченных Session-а
   (свёртка «N done» на Canvas, группа в rail-е). Сегодня `error` в rail-е не в группе (`:92`): исполнитель
   либо собирает `done`, `error` и `interrupted` в одну группу законченных, либо даёт одно действие
   «Hide finished» на все такие записи Session-а — на выбор, снимки в «Итог». Кнопка у одной записи есть
   при любом статусе, и у `running` тоже: так убирается запись, процесс Session-а которой не известен
   (`sessionRuns` → `null`).
6. **Хранение скрытых.** Список скрытых записей (Session и id записи) хранит main, на диске worfy в данных
   Project-а, не в `~/.claude` (это файлы Claude Code). Канал IPC — рядом с `claudeHome.subagents`
   (`src/shared/ipc/claude-home.ts:154`). Скрытая запись не показывается ни на Canvas, ни в rail-е, и
   после перезапуска worfy тоже. Вернуть скрытое — действие «Show hidden Subagents» на Session (или в
   Command palette), чтобы скрытие не было необратимым.
7. На экране только для чтения (Linked machine, worfy-link 25) «Hide» не показывается или выключена:
   канал пишущий.

## Где в коде

- `src/shared/transcript/subagents.ts` — `SubagentStatus`, сигнал, `statusOf`, `describeRun`.
- `src/main/claude-home/subagents.ts` — `sessionRuns`, `SubagentReader.session`.
- `src/shared/ipc/claude-home.ts`, `src/main/ipc/claude-home.ts` — канал скрытых записей.
- `src/renderer/canvas/nodes/SubagentNode.tsx`, `src/renderer/session/rail/SubagentsRail.tsx`,
  `src/renderer/canvas/sources/subagents.ts` — статус, кнопка «Hide», фильтр скрытых.
- `docs/adr/0085-interrupted-subagents.md` — новый ADR (номер — проверить при claim).
- Test-ы: `test/unit/subagents.test.ts`, `test/contract/claude-home-subagents.test.ts`,
  `test/contract/claude-home-subagents-link.test.ts`, `test/unit/subagent-nodes.test.tsx`,
  `test/unit/subagent-trees.test.tsx`, `test/unit/link-access.test.ts`, `test/e2e/subagent-tree.spec.ts`.

Только читать: `src/main/claude-home/registry.ts` (`processState`, разбор `procStart`),
`docs/adr/0031-closed-session-ends-its-subagents.md`.

Платформенный PR — да: признак строится на времени запуска процесса, а его разбор разный на macOS и
Windows (ADR-0056). Merge ждёт Windows-проверку по правилу ADR-0056.

## Готово, когда

- [ ] Unit, `statusOf`: Subagent без конца, процесс Session-а запущен после последней записи в его
  transcript, — `interrupted`; запущен до последней записи — `running`.
- [ ] Unit: процесс Session-а не известен (`sessionRuns` → `null`) — Subagent без конца остаётся
  `running`, как сегодня; закрытая Session — `error`, как сегодня (ADR-0031).
- [ ] Contract: `SubagentReader.session` отдаёт время запуска живого процесса; запись `sessions/` без
  `procStart` даёт прежнее поведение.
- [ ] Test хранения: скрытая запись остаётся скрытой после перезапуска (новый экземпляр хранилища читает
  тот же файл); «Show hidden Subagents» возвращает её.
- [ ] e2e или component test кнопки «Hide»: одна запись и группа законченных исчезают с Canvas и из
  rail-а; одна запись `running` тоже скрывается; «Hide» группы законченных `running` не трогает.
- [ ] Новый ADR (0085 или следующий свободный) — Статус: принят.
- [ ] Снимки панели Subagent-ов (Canvas и rail, со статусом `interrupted` и кнопкой «Hide») в светлой и
  тёмной теме — в «Итог»; reviewer их проверил.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; затронутые e2e — exit 0.

## Вне скоупа

- Таймаут по возрасту файла или тишине (отвергнут ADR-0031).
- Subagent-ы при неизвестном процессе (`sessionRuns` → `null`): остаются `running`, статус не
  меняется; такую запись убирает кнопка «Hide» у неё самой.
- Удаление файлов transcript-ов Subagent-ов.
