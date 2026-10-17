# 19 — Test-ы, зависящие от порядка файлов, и временные файлы test-ов в src

Type: task
Status: done 2026-10-06
PR: #77
Blocked by: 17
Source: [spec.md](../spec.md), тема E; HANDOFF worfy-mvp, «Риски и долги» (Ticket 28 worfy-mvp)

## Что делаем

Три unit-test-а проверяют, что новый файл подхватывается через `import.meta.glob`. Для этого они
пишут временные файлы прямо в исходники:

- `test/unit/canvas.test.tsx` — `src/renderer/canvas/nodes/ZzVitestProbeNode.tsx` (запись `:31-36`,
  удаление `:38-40`);
- `test/unit/shell-discovery.test.tsx` — `ZzVitestProbeSection.tsx` в `src/renderer/shell/sidebar` и
  `ZzVitestProbe.tsx` в `src/renderer/shell/toolbar` (`:23-24`, запись `:50`, удаление `:34` и
  `:54`);
- `test/unit/session-rail-discovery.test.tsx` — `ZzVitestProbeBlock` в `src/renderer/session/rail/`
  (`:18`, запись `:31`, удаление `:35`).

**Что из этого выходит** (HANDOFF worfy-mvp):

- **Test зависит от порядка файлов.** Речь о test-е «draws a Node type added as one file» из
  `canvas.test.tsx`. Трансформация `nodes/index` общая на весь запуск. Если её первым делает другой
  файл, временный тип Node-а в реестр не попадает. Воспроизводилось командой
  `--sequence.shuffle.files --sequence.seed=3`.
- **Нынешний обход хрупкий.** Это `vi.mock` реестра в `test/unit/focus-mode.test.tsx:12-14`. Любой
  новый test, который импортирует реестр раньше, снова сломает порядок.
- **Временный файл попадает в чужой вход.** Если параллельно идут lint, typecheck или build, он
  попадает и к ним. Если vitest убит посреди test-а, `ZzVitestProbe*` остаётся в `src/` до следующего
  прогона. Для `rail/` есть гонка внутри vitest: другой worker впервые трансформирует
  `rail/index.ts` через dom-smoke → `main.tsx` и видит временный блок.

**Решение — ADR (номер с 0022).** Варианты:

- изолировать модуль: `vi.resetModules` или отдельный файл с `isolate`;
- отказаться от временных файлов в `src/`.

Ценность этих test-ов — проверка настоящего glob. Если ADR от неё отказывается, он пишет, что её
заменяет.

**Минимум в любом варианте:**

- `ZzVitestProbe*` в `.gitignore` и в ignore у eslint;
- guard в начале прогона удаляет старые `ZzVitestProbe*`;
- шаг CI `git status --porcelain src` после `pnpm test`;
- шаг CI с `--sequence.shuffle.files`;
- `vi.mock` реестра в `focus-mode.test.tsx` убирается.

## Готово, когда

- [x] ADR принят.
- [x] `pnpm vitest run --sequence.shuffle.files --sequence.seed=3` зелёный. Ещё 5 случайных seed — тоже зелёные, числа в «Итог». Проверено командой `pnpm test …` вместо буквальной — причина в «Итог».
- [x] После `pnpm test` в `src/` нет `ZzVitestProbe*`. После убитого посреди прогона vitest и следующего прогона — тоже нет. Это проверяет шаг CI с `git status --porcelain src`.
- [x] В `focus-mode.test.tsx` нет `vi.mock` реестра Node-ов.
- [x] Проверка «файл добавлен — подхватился» осталась для Node-ов, разделов sidebar, элементов toolbar и блоков правой панели Session — если ADR не решил иначе.

## Тесты

- Сами три test-а.
- Шаг CI с перемешанным порядком файлов.
- Сначала падающий test: прогон с `seed=3` без `vi.mock` в `focus-mode.test.tsx` — `canvas.test.tsx` красный.

## Где в коде

- `test/unit/canvas.test.tsx`
- `test/unit/shell-discovery.test.tsx`
- `test/unit/session-rail-discovery.test.tsx`
- `test/unit/focus-mode.test.tsx`
- `vitest.config.ts`
- `.gitignore`
- `eslint.config.js`
- `.github/workflows/ci.yml`

## Итог

**Решение** — [ADR-0036](../../../docs/adr/0036-glob-discovery-tests-without-src-files.md): временных
файлов в `src/` больше нет. Новый helper `test/unit/glob-probe.tsx` строит во временном каталоге
системы зеркало репозитория. Каталоги на пути к каталогу glob-а там настоящие, остальное —
symlink-и на настоящие файлы. Проверяемый модуль скопирован байт в байт, рядом лежит образец.
Test импортирует копию. Шаблон glob-а — настоящий, без правки. Результат содержит настоящие файлы
каталога и образец.

**Код и конфиг.**
- `canvas.test.tsx` подменяет реестр Node-ов его копией через `vi.mock` с фабрикой. Настоящий
  `Canvas.tsx` рисует Node образца.
- `shell-discovery.test.tsx` и `session-rail-discovery.test.tsx` импортируют копии `Sidebar.tsx`,
  `Toolbar.tsx` и `rail/index.ts`. Rail-test ещё проверяет, что найдены настоящие блоки.
- `vi.mock` реестра в `focus-mode.test.tsx` убран.
- `vitest.config.ts`:
  - `server.fs.allow` включает `os.tmpdir()`, иначе Vite не грузит копию;
  - в начале запуска удаляются `src/**/ZzVitestProbe*`;
  - в начале запуска удаляются каталоги `worfy-glob-probe-*` старше часа.
- `ZzVitestProbe*` внесён в `.gitignore` и в ignore ESLint.
- CI:
  - `pnpm test --sequence.shuffle.files` вместо `pnpm test`, прогон test-ов по-прежнему один;
  - шаг «src/ is unchanged after the tests» —
    `git status --porcelain --untracked-files=all --ignored src`. `--ignored` нужен: после
    `.gitignore` иначе `ZzVitestProbe*` не видно.
- `test/unit/glob-probe.tsx` — новый файл, вне следа. Он `.tsx`, потому что
  `tsconfig.test.web.json` перечисляет только `test/**/*.tsx`.

**Сначала красный.** Без `vi.mock` в `focus-mode.test.tsx` красный `canvas.test.tsx` («draws a
Node type added as one file»). Команда:
`vitest run test/unit/focus-mode.test.tsx test/unit/canvas.test.tsx --no-file-parallelism
--sequence.shuffle.files --sequence.seed=3` (seed-ы 1, 2, 4, 5, 6 там же зелёные). Полный набор с
seed 3 без `vi.mock` на базе f2ca168 был зелёным: состав файлов изменился со времени HANDOFF. После
правки те же два файла вместе с `shell-discovery` и `session-rail-discovery` прогнали так же с
seed 1–4: все зелёные, и seed 3 тоже.

**Seed-ы полного набора** — `pnpm test --sequence.shuffle.files --sequence.seed=<N>`, 1995 test-ов
каждый:
- 3, 17, 4242, 90210, 7 — зелёные;
- 123456 — красный один раз, только `test/contract/claude-home-registry.test.ts` (известный
  нестабильный, вне этой Wave); повторный прогон зелёный.

Буквальная команда пункта `pnpm vitest run …` запускает vitest под системным Node, а не под Node
из Electron. На ней краснеет `test/unit/runtime.test.ts` («runs under the Node built into
Electron»), и так было и раньше. Поэтому пункт проверен через `pnpm test …`: это тот же vitest под
Electron. Решено без владельца, подтвердить.

**Мутанты glob-ов.** Каждый шаблон испорчен по очереди, и test краснеет:
- `nodes/index.ts` `./*Node.tsx` → `./*Nodes.tsx` — `canvas.test.tsx`;
- `Sidebar.tsx` `./sidebar/*Section.tsx` → `*Sections.tsx` — `shell-discovery`;
- `Toolbar.tsx` `./toolbar/*.tsx` → `./toolbar/A*.tsx` — `shell-discovery`;
- `rail/index.ts` `./*.tsx` → `./*Rail.tsx` — `session-rail-discovery`.

**`src/` после прогонов.** `git status --porcelain --ignored src` пуст после `pnpm test`.
Проверили и убитый прогон. Полный vitest убит `kill -9`, когда временный каталог уже был. `src/`
после этого пуст, следующий `pnpm test` зелёный, и `src/` снова пуст. Шаг CI проверен локально:
- на чистом дереве — код 0;
- с `src/renderer/session/rail/ZzVitestProbeBlock.tsx` — код 1 и строка
  `!! src/renderer/session/rail/ZzVitestProbeBlock.tsx`.

Guard удаляет `src/**/ZzVitestProbe*`: подложенный `ZzVitestProbeNode.tsx` исчез после запуска.
Каталог `worfy-glob-probe-*` с mtime старше часа удаляется, свежий остаётся.

**Ревью** ([PR #77](https://github.com/IDSAD-XL/worfy/pull/77), VERIFIED, без доработки): test-ы
обнаружения по-прежнему краснеют на испорченном glob настоящего модуля (свои 4 мутанта); уборка при
старте удаляет только каталоги старше часа; перемешанный порядок в CI — один прогон, без повторов.
Долг [low]: `test/unit/focus-mode.test.tsx:11-12` — две пустые строки подряд. Прогон длиннее часа
может потерять свою копию от уборки параллельного запуска (`vitest.config.ts:28-37`) — это не долг
ревью, а риск, принятый в [ADR-0036](../../../docs/adr/0036-glob-discovery-tests-without-src-files.md),
строки 47–48.
