# 45 — Старые записи Subagent-ов: статус `interrupted` и кнопка «Hide»

Type: task
Status: done 2026-10-29T11:23Z
PR: #975
Branch: worfy-polish/45
Blocked by: —
Source: жалоба владельца и его решение 2026-10-29 (принято, ниже). Строки — по main `80149146`.

## Зачем

В панели Subagent-ов у владельца висят записи «running 546h» и старые записи `error`. Убить процессы и
перезапустить worfy не помогает: записи остаются. Сегодня убрать их можно только одним способом —
отправить в архив родительскую Session: архивная Session уносит своё дерево Subagent-ов с собой
(`src/renderer/canvas/sources/subagents.ts:238`). Архивировать рабочую Session ради чистой панели —
неправильный обмен.

Случай «новый процесс, тот же `sessionId`, Subagent умер со старым процессом» — реальный: продолженная
Session Claude Code сохраняет свой `sessionId`. Transcript Orchestrator-а `f6ab7045` 2026-10-29
продолжился в том же файле через три перезапуска worfy.

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
- ADR-0031 отверг новый статус как таковой (`:51-54`): оборванный Subagent по смыслу — `error` (тот же
  конец без результата, что `stoppedByUser`), а новый статус трогает все исчерпывающие таблицы статусов.
  Там же отвергнут переход `running` → `done` по тишине файла (`:55-56`): живой Subagent может молчать
  долго. Решение ниже пересматривает первый довод ADR-0031 по решению владельца; второй остаётся в силе:
  признак — не timeout, а смена процесса.
- Убрать запись из панели нельзя. `SubagentNode` (`src/renderer/canvas/nodes/SubagentNode.tsx`) даёт
  только кнопку «Transcript» (`:109-119`, tooltip «Open the transcript of this Subagent» — `:114`) и
  свёртку «N done» (`:151-163`, текст — `:163`). В rail-е (`src/renderer/session/rail/SubagentsRail.tsx`)
  законченные — в группе «Done (N)» (`:91`, `:129-140`), а `error` стоят вместе с `running` в верхнем
  списке (`:92`).
- Где код ветвится по статусу Subagent-а (все места меняются в этом Ticket-е):
  - тип `SubagentStatus` — `src/shared/transcript/subagents.ts:124`; схема сигналов — `:68`; `endedAt` —
    `:572`, `:604`; статус прогона workflow по его агентам — `:721-722`;
  - `CHIP` — `src/renderer/canvas/nodes/SubagentNode.tsx:66` и `src/renderer/session/rail/SubagentsRail.tsx:24`;
  - подпись статуса — `src/renderer/claude-home/subagents.ts:281-282`;
  - опрос каждые `POLL_MS`, пока что-то `running`, — `src/renderer/claude-home/subagents.ts:129`, `:137-138`,
    `:256`;
  - тикающий счётчик времени — `SubagentNode.tsx:69`, `SubagentsRail.tsx:158`; ребро —
    `src/renderer/canvas/edges/subagents.ts:23`;
  - свёртка законченных — `src/renderer/canvas/sources/subagents.ts:138-139`, `SubagentsRail.tsx:91-92`.

## Решение владельца (2026-10-29, принято)

Старые записи Subagent-ов убираются двумя путями.

1. **Новый статус `interrupted`.** Subagent без записи о конце, у родительской Session которого текущий
   процесс запущен ПОЗЖЕ последней записи в transcript Subagent-а, умер вместе с прежним процессом (выход
   из worfy, падение, рестарт Session-а). Это точный признак, а не timeout по возрасту. Он пересматривает
   довод ADR-0031 против нового статуса по решению владельца. Нужен новый короткий ADR.
2. **Кнопка «Hide»** у одной записи Subagent-а и у всей группы законченных (`done` и `error`) — в
   `SubagentNode` и в `SubagentsRail`. Скрытые записи остаются скрытыми после перезапуска worfy.

Правка 2026-10-29 (решение владельца R2-Q6, `.scratch/worfy-throughput/spec.md`, раздел «Ответы владельца
2026-10-29, раунд 2»): статус `interrupted` рисуется нейтральным серым — не красным (это не ошибка) и не янтарным.
Подпись чипа — «Interrupted». Tooltip говорит, что процесс Session-а перезапустился и Subagent закончился вместе
с прежним процессом. Решение R2-Q5 того же списка: Ticket уходит в работу сейчас, параллельно с Ticket-ами 11 и
33 Epic-а `worfy-throughput`; это платформенный PR (в diff есть `test/e2e/**`).

## Что делаем

1. **ADR.** Новый ADR с номером 0085 — следующий свободный на main 2026-10-29 (последний — 0084; открытые
   PR #958 и #960 правят только 0083). При claim номер проверить заново (`gh pr list --state open --json
   files`). Содержание ADR:
   - статус `interrupted` и его признак;
   - довод ADR-0031 (`:51-54`) против нового статуса: оборванный Subagent по смыслу `error`, а новый
     статус трогает все исчерпывающие таблицы статусов. Ответ: владелец решил 2026-10-29 иначе.
     `interrupted` отличается от `error`: агент не упал, его процесс завершили снаружи (выход из worfy,
     падение, рестарт Session-а), поэтому пользователь может продолжить работу или не обращать внимания.
     Таблицы статусов (список в «Что происходит») меняются в этом же Ticket-е;
   - почему при неизвестном процессе остаётся `running`.

   Новый ADR ссылается на ADR-0031. ADR-0031 принят, поэтому его текст не меняется: в конец
   дописывается раздел `## Amendments` с датой и ссылкой на новый ADR (как в
   `docs/adr/0066-read-only-access-for-a-linked-machine.md:81`).
2. **Признак.** Время запуска процесса — число `startedAt` (ms) записи `sessions/<pid>.json` (схема —
   `src/main/claude-home/registry.ts:338`). `procStart` не разбирается: он остаётся только проверкой
   «процесс жив» (строки сравниваются как есть, `registry.ts:295`, `:308`). `sessionRuns` при живом
   процессе отдаёт и `startedAt` его записи; `SubagentReader.session` кладёт его новым сигналом рядом с
   `session-closed` (схема `subagentSignalSchema`, `src/shared/transcript/subagents.ts:68`).
3. **Статус.** `SubagentStatus` получает `interrupted`. Правило в `statusOf` — для любого
   Subagent-а, агенты workflow-скрипта тоже идут через него (`:549`, `:687`): Subagent без конца, у которого `startedAt` текущего процесса Session-а больше его последней
   записи в transcript (`file.lastAt`, ms, `src/shared/transcript/subagents.ts:367-370`), — `interrupted`.
   Иначе — `running`, как сейчас. Процесс не известен (`sessionRuns` → `null`) или у записи нет
   `startedAt` — `running`, как сейчас. Session закрыта — `error`, как сейчас (ADR-0031). Статус прогона
   workflow по его агентам (`:721-722`) учитывает `interrupted`.
4. **UI статуса.** `interrupted` — во всех местах из списка в «Что происходит»: обе таблицы `CHIP`,
   подпись статуса, счётчик времени, ребро, свёртка законченных на Canvas и в rail-е. Он законченный,
   как `done` и `error`: опрос (`src/renderer/claude-home/subagents.ts:129`) его не считает, и renderer
   Session-а, где остались только законченные и `interrupted`, больше не опрашивает. Вид чипа — по решению
   владельца 2026-10-29 (R2-Q6, ниже), снимки в «Итог». (Заменено решением владельца 2026-10-29 (R2-Q6):
   было «цвет чипа — на выбор исполнителя».)
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

- `src/shared/transcript/subagents.ts` — `SubagentStatus`, сигнал, `statusOf`, `describeRun` (статус прогона), свод по агентам `:719-722`.
- `src/main/claude-home/subagents.ts` — `sessionRuns`, `SubagentReader.session`.
- `src/shared/ipc/claude-home.ts`, `src/main/ipc/claude-home.ts` — канал скрытых записей.
- `src/renderer/canvas/nodes/SubagentNode.tsx`, `src/renderer/session/rail/SubagentsRail.tsx`,
  `src/renderer/canvas/sources/subagents.ts` — статус, кнопка «Hide», фильтр скрытых.
- `src/renderer/claude-home/subagents.ts` — опрос и подпись статуса;
  `src/renderer/canvas/edges/subagents.ts` — ребро.
- `docs/adr/0085-interrupted-subagents.md` — новый ADR (номер — проверить при claim).
- `docs/adr/0031-closed-session-ends-its-subagents.md` — только раздел ## Amendments: дописанный раздел с
  датой и ссылкой на новый ADR.
- Test-ы: `test/unit/subagents.test.ts`, `test/contract/claude-home-subagents.test.ts`,
  `test/contract/claude-home-subagents-link.test.ts`, `test/unit/subagent-nodes.test.tsx`,
  `test/unit/subagent-trees.test.tsx`, `test/unit/link-access.test.ts`, `test/e2e/subagent-tree.spec.ts`.

Только читать: `src/main/claude-home/registry.ts` (схема записи `sessions/<pid>.json`, `processState`).

Платформенный PR — да: в списке файлов `test/e2e/subagent-tree.spec.ts`, а
`scripts/windows-verdict-scope.mjs:80` относит `test/e2e/**` к проверке на Windows-ПК. Merge ждёт
Windows-проверку по правилу ADR-0056.

## Готово, когда

- [x] Unit, `statusOf`: Subagent без конца, `startedAt` процесса Session-а позже его последней записи в
  transcript, — `interrupted`; раньше — `running`.
- [x] Unit, та же секунда: последняя запись за 300 ms до `startedAt` нового процесса — `interrupted`;
  через 300 ms после — `running`.
- [x] Unit, агент workflow-скрипта (`statusOf`): агент без конца, `startedAt` позже его последней записи, —
  `interrupted`.
- [x] Unit, прогон workflow-скрипта: у прогона нет своего transcript (`describeRun`, `:595-604`).
  Прогон с вызовом без конца — `interrupted`, когда хотя бы один его агент `interrupted` и ни один не
  `running`; прогон без агентов — `interrupted`, когда `startedAt` процесса позже `workflow?.at` (или
  `result?.at`). Свод по агентам (`:721-722`) это учитывает; такой прогон не держит опрос renderer-а.
- [x] Unit: процесс Session-а не известен (`sessionRuns` → `null`) или у записи нет `startedAt` —
  Subagent без конца остаётся `running`, как сегодня; закрытая Session — `error`, как сегодня (ADR-0031).
- [x] Unit, опрос: Session, где остались только законченные и `interrupted`, renderer не опрашивает
  (`setInterval` каждые `POLL_MS` не запущен или снят, `src/renderer/claude-home/subagents.ts:137-140`).
- [x] Contract: `SubagentReader.session` отдаёт `startedAt` записи живого процесса; запись без
  `startedAt` даёт прежнее поведение.
- [x] Test хранения: скрытая запись остаётся скрытой после перезапуска (новый экземпляр хранилища читает
  тот же файл); «Show hidden Subagents» возвращает её.
- [x] e2e или component test кнопки «Hide»: одна запись и группа законченных исчезают с Canvas и из
  rail-а; одна запись `running` тоже скрывается; «Hide» группы законченных `running` не трогает.
- [x] Новый ADR (0085 или следующий свободный) — Статус: принят; ADR-0031 получил раздел
  `## Amendments` со ссылкой на него.
- [x] Чип `interrupted` — нейтральный серый, подпись «Interrupted», tooltip о перезапуске процесса Session-а —
  на Canvas и в rail-е; unit или component test проверяет подпись и tooltip (решение владельца 2026-10-29,
  R2-Q6).
- [x] Снимки панели Subagent-ов (Canvas и rail, со статусом `interrupted` и кнопкой «Hide») в светлой и
  тёмной теме — в «Итог»; reviewer их проверил.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; затронутые e2e — exit 0.

## Вне scope

- Timeout по возрасту файла или тишине (отвергнут ADR-0031).
- Subagent-ы при неизвестном процессе (`sessionRuns` → `null`): остаются `running`, статус не
  меняется; такую запись убирает кнопка «Hide» у неё самой.
- Удаление файлов transcript-ов Subagent-ов.

## Итог

Влит #975 (`cf64639c`), ADR-0085. Subagent без конца получает `interrupted`, когда `startedAt` процесса
Session-а позже его последней записи; время процесса идёт в необязательном поле верхнего уровня
`processStartedAt`, поэтому Linked peer на старой сборке ответ не отвергает (ADR-0079, пункт 8 ADR-0085).
Скрытые записи — `<dataDir>/<projectId>/hidden-subagents.json`, «Show hidden Subagents» возвращает их.
Проверка: unit `subagent-nodes`, `subagent-trees`, contract `claude-home-registry`, e2e
`subagent-tree.spec.ts` (новый test: Canvas и rail, Hide, перезапуск, Show hidden); 17 мутантов
implementer-а и 7 мутантов reviewer-а красные. Ревью: круг 1 REJECTED (high — новый сигнал ломал ответ
старому Linked peer-у), круг 2 VERIFIED. Снимки в обеих темах (Canvas и rail с `interrupted`) лежали в
scratchpad implementer-а, reviewer их смотрел. Windows: gate full на ПК красный от нагрузки (6 файлов
vitest с timeout-ами зелёные отдельным запуском), e2e `browser-family.spec.ts:154` — 2/19 на #975 против
0/18 на main, diff его не трогает; check/windows success.

Долг ([low], из вердикта): на новом экране поверх старого peer-а «Hide» молча ничего не делает, только
`console.error` на каждый mount.
