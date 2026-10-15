# 20 — Два flaky contract test-а: timeout в `harness-script-wiring`, ENOTEMPTY в `harness-drift`

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-15 по Gate Ticket-ов worfy-polish (разделы «Gate оркестратора
(2026-10-15)»): [01](01-панель-выделения-не-закрывает-шапку-рамки-epic-а.md) — CI красный в
`test/contract/harness-drift.test.ts` (уборка временной папки, ENOTEMPTY; вне diff);
[02](02-контраст-цвета-8-и-suggestion-в-terminal.md) и
[10](10-палитра-ищет-в-транскриптах-session-ов-вне-worfy.md) — gate full красный по timeout-у 15 s
в `harness-script-wiring.test.ts` (вне diff); «Итог»
[03](03-contract-test-ы-без-настоящего-claude-home.md) — тот же timeout и «следом лишняя строка в
файле вызовов от прерванного test-а». Слово владельца: найти причину, timeout вслепую не поднимать.

## Что происходит

Оба test-а краснят gate и CI чужих PR. Повтор зелёный, но merge съезжает: main успевает уйти.

### 1. `harness-script-wiring.test.ts` — timeout 15 s

- Test «the layout cache and the workflow read ask the source on each read»
  (`test/contract/harness-script-wiring.test.ts:357-371`). Предел — `testTimeout: 15_000`
  (`vitest.config.ts:68`).
- Падал под нагрузкой: gate full Ticket-ов 02 и 10 (load average до 23), прогоны Ticket-а 03 (load
  average 7–27). Отдельно файл зелёный: 21 из 21 (Ticket 03), 45/45 и 21/21 (Gate 10).
- Test запускает настоящие процессы: `LayoutCache.get` — stub-скрипты `profile` и `ticket` (shell);
  `readWorkflow` (`src/main/workflow/reader.ts:424`) — ещё раз layout и `epic-status`. Корень —
  `scratch`, временная папка вне git.
- **Общее состояние протекает в следующий test** (проверено чтением кода). `calls`, `asked` и
  `source` — переменные `describe` (`:315-318`). `source` читает `calls` и `scratch` в момент вызова,
  а не при создании (`:324-327`). Если test прерван timeout-ом, его цепочка вызовов продолжается.
  Следующий `beforeEach` уже поставил новые `scratch` и `calls`, и stub старого test-а пишет строку в
  файл вызовов нового. Это и есть «лишняя строка» из «Итог» Ticket-а 03. Причину самого timeout-а
  это не объясняет.

### 2. `harness-drift.test.ts` — ENOTEMPTY при уборке

- `afterEach` удаляет временные папки test-ов (`test/contract/harness-drift.test.ts:15-17`) через
  `removeTestTree` (`test/remove.ts:16-18`). Вне Windows это `rmSync(path, { recursive: true, force:
  true })` без повторов (`src/main/storage/remove.ts:293-301`).
- ENOTEMPTY у `rmSync` значит: пока папку удаляли, в ней появился файл. Кто его пишет — неизвестно.
  Кандидаты, не проверены:
  - `git` из `checkHarnessDrift`, который ещё идёт после конца test-а (`execFile` с `timeout:
    GIT_TIMEOUT_MS` = 10 s, `src/main/autopilot/harness-drift.ts:39`, `:65`);
  - фоновая работа `git` после `commit` (auto gc, maintenance): helper `git` test-а не выключает её
    (`harness-drift.test.ts:27-29`);
  - `git`-обёртка `loggingGit`, которая пишет журнал вызовов в ту же временную папку (`:57-65`).
- Видели один раз, в Linux CI (первая попытка merge PR #348, Ticket 01).

## Что делаем

1. **Найти причину timeout-а** в `harness-script-wiring`. Под нагрузкой (`yes > /dev/null`, половина
   ядер) прогнать файл в цикле до первого красного и замерить время каждого шага test-а
   (`cache.get`, `readWorkflow`, каждый запуск stub-а). Записать в «Итог», куда ушли 15 s.
2. **Убрать протечку состояния.** Каждый test получает свои `calls`, `asked`, `source` (замыкание на
   значения своего `beforeEach`, а не на переменные `describe`). Test: прерванный test не пишет в
   файл вызовов следующего — мутант «`source` читает переменную `describe`» его краснит.
3. **Найти, кто пишет в папку `harness-drift`.** Первый шаг — лог упавшего job-а CI (PR #348):
   какой test и какой путь. Затем воспроизвести: под нагрузкой, в цикле, при необходимости с
   журналом процессов `git` (обёртка, которая пишет PID и время). Причина — в «Итог».
4. **Лечить причину.** Test ждёт конца всех своих процессов до уборки, или выключает фоновую работу
   `git` в своём helper-е (`-c gc.auto=0`, `-c maintenance.auto=false`), — по найденной причине.
   `maxRetries` в `removeTree` без найденной причины не добавлять.
5. **Timeout не поднимать вслепую.** Если после пунктов 1–2 test честно идёт дольше 15 s под
   нагрузкой — предел для этого test-а поднимается только с замером из пункта 1 и пометкой «решено
   без владельца, подтвердить».

## Готово, когда

- [ ] Причины обоих падений названы в «Итог» с доказательством: вывод прогона, в котором test
      красный до правки.
- [ ] После правки под той же нагрузкой: `harness-script-wiring.test.ts` и `harness-drift.test.ts` —
      0 красных из N прогонов (N — не меньше числа прогонов до первого красного × 3); вывод в «Итог».
- [ ] Test на протечку состояния (пункт 2) и его мутант — красный на мутанте.
- [ ] `testTimeout` в `vitest.config.ts` и пределы в файлах не подняты (или подняты по пункту 5).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `node scripts/vitest-electron.mjs --project contract <файл>` в цикле shell — под нагрузкой и без;
  у каждого прогона — код выхода.
- Нагрузка — только когда других агентов Wave нет: в Wave Ticket-ов 01–11 нагрузка одного Ticket-а
  краснила gate соседей (Gate Ticket-ов 04 и 05).

## Где в коде

- `test/contract/harness-script-wiring.test.ts`
- `test/contract/harness-drift.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `src/main/workflow/folder.ts`,
`src/main/workflow/reader.ts`, `src/main/autopilot/harness-drift.ts`, `src/main/storage/remove.ts`,
`test/remove.ts`, `vitest.config.ts`. Если причина в коде приложения — исполнитель дописывает файл в
«Где в коде» при claim.

## Вне скоупа

- Расписание gate параллельных исполнителей под нагрузкой — Harness (spec.md, «Не в этом Epic-е»).
- Другие test-ы с timeout-ом под нагрузкой (`workflow-reader.test.ts`, `github-prs.test.ts`,
  `docs.test.ts`) — только если причина та же; иначе — запись в «Итог» как кандидат.

## Итог

—
