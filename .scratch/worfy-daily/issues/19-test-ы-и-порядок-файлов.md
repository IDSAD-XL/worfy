# 19 — Test-ы, зависящие от порядка файлов, и временные файлы test-ов в src

Type: task
Status: blocked — blocked by 17
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

- [ ] ADR принят.
- [ ] `pnpm vitest run --sequence.shuffle.files --sequence.seed=3` зелёный. Ещё 5 случайных seed — тоже зелёные, числа в «Итог».
- [ ] После `pnpm test` в `src/` нет `ZzVitestProbe*`. После убитого посреди прогона vitest и следующего прогона — тоже нет. Это проверяет шаг CI с `git status --porcelain src`.
- [ ] В `focus-mode.test.tsx` нет `vi.mock` реестра Node-ов.
- [ ] Проверка «файл добавлен — подхватился» осталась для Node-ов, разделов sidebar, элементов toolbar и блоков правой панели Session — если ADR не решил иначе.

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
