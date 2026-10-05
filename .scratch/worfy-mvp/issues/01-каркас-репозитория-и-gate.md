# 01 — Каркас репозитория: пустое приложение собирается, тестируется и проходит gate.sh fast

Type: task
Status: done — 2026-10-05, [PR #1](https://github.com/IDSAD-XL/worfy/pull/1)
Blocked by: —
Source: [spec.md](../spec.md), разделы «Как устроено» и «Соглашения для тикетов этого эпика»; [ADR-0004](../../../docs/adr/0004-stack-electron-ts-react-flow-agent-sdk.md)

## Что делаем

Репозиторий пуст: `README.md`, `.gitignore`, `CONTEXT.md`, `docs/`, `HANDOFF.md` (его завёл
оркестратор вместе с эпиком). Нужен каркас, на котором остальные тикеты эпика пишут код и сразу
проверяются тем же Gate (`~/.claude/hooks/gate.sh`, проверка готовности изменений), что и в
других проектах, и минимальный CI на GitHub, чтобы с тикета 02 условие «PR с зелёным CI»
можно было проверить. Сборка `.app`, нативный `node-pty` под Electron и e2e в CI — тикет 32.

- pnpm, один пакет (без workspaces). `electron-vite` для сборки main, preload и renderer. TypeScript
  `strict` во всех трёх. React в renderer. ESLint (flat config) с правилами для TS и React hooks.
- Все зависимости эпика ставятся сразу, с точными версиями, чтобы параллельные тикеты не дрались
  за `package.json` и lockfile: `@xyflow/react`, `@anthropic-ai/claude-agent-sdk`, `zod`,
  `zustand`, `chokidar`, `react-markdown`, `remark-gfm`, `node-pty`, `@xterm/xterm`,
  `@xterm/addon-fit`; dev — `vitest`, `jsdom`, `@testing-library/react`, `@playwright/test`,
  `@electron/rebuild`, `electron-builder`.
- `pnpm.onlyBuiltDependencies` в `package.json`: `electron` (скачивает бинарник), `esbuild`,
  `node-pty` и другие пакеты, которым нужен install-скрипт. Без списка pnpm 10 молча пропускает
  их скрипты, и Electron не запускается.
- Поле `packageManager` в `package.json` с точной версией pnpm — по нему pnpm ставится и локально
  (corepack), и в CI.
- Скрипты `package.json`: `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit` по всем tsconfig),
  `test`, `test:e2e`.
  - `test` — vitest (`test/unit` + `test/contract`, без e2e) под Node из Electron:
    `ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run`. Так нативные модули,
    собранные под ABI Electron (`node-pty`, тикет 32), грузятся в test-ах так же, как в main.
  - `test:e2e` — сначала `electron-vite build`, потом Playwright `_electron` против `out/`:
    e2e никогда не идёт против устаревшей сборки.
- `vitest.config.ts`: два проекта — `node` для `*.test.ts` и `jsdom` + `@testing-library/react`
  для `*.test.tsx` (компоненты renderer-а), общий setup в `test/setup-dom.ts`.
- Main открывает одно окно с текстом «worfy». `src/main/storage/paths.ts` отдаёт корень данных
  (`WORFY_DATA_DIR`, по умолчанию `~/Library/Application Support/worfy`) и корень Claude
  (`WORFY_CLAUDE_HOME`, по умолчанию `~/.claude`). Других мест, откуда код узнаёт эти пути, нет.
- `test/e2e/helpers.ts` — `launchApp()`: собирает временные `WORFY_DATA_DIR` и
  `WORFY_CLAUDE_HOME`, ставит `WORFY_AGENT=fake`, запускает приложение, закрывает и чистит за
  собой. Все следующие e2e-tests пользуются им.
- `.gitignore`: добавить `.claude/worktrees/`. vitest, ESLint и tsconfig исключают
  `.claude/worktrees/**`, иначе прогон в основном checkout подхватит test-ы чужих worktree.
- CI: `.github/workflows/ci.yml`, один workflow и один job на `macos-latest`, запуск на
  `pull_request` и на `push` в `main`. Шаги: checkout, `pnpm/action-setup` (версия из
  `packageManager`), `actions/setup-node`, `pnpm install --frozen-lockfile`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`. Install-скрипты пакетов разрешены тем же
  `pnpm.onlyBuiltDependencies`, поэтому `electron` скачивается и `pnpm test` идёт под Node из
  Electron так же, как локально. Больше ничего: кэш, `concurrency`, e2e и сборку `.app` добавляет
  тикет 32 в этот же файл.
- Gate: запись `worfy` в `~/.claude/gate/config.json` — `match` `/Users/alexey/Stuff/CanvasForAI`,
  `pm` `pnpm`, `root.fast` = `lint typecheck test`, `root.full` = то же + `test:e2e`, `workspace`
  пустой, `root_if` — исходники TS/JS/CSS/HTML, `package.json`, `tsconfig*`, `eslint*`. Файл
  лежит вне репозитория и общий для всех проектов; запись одобрена владельцем. В PR её нет, в
  «Итог» пишется дифф записи.

## Готово, когда

- [x] `pnpm install && pnpm build` → код 0 на чистом клоне; в выводе `pnpm install` нет «Ignored build scripts».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` → код 0.
- [x] `pnpm test` идёт под Electron: test `runtime.test.ts` видит `process.versions.electron`.
- [x] Компонентный test `*.test.tsx` рендерит React-компонент в jsdom и проходит в `pnpm test`.
- [x] `pnpm test:e2e` → код 0 без отдельного `pnpm build`: smoke test запускает приложение, видит окно с текстом «worfy» и закрывает его; правка текста в `src/renderer/main.tsx` видна следующему прогону.
- [x] `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh fast </dev/null; echo $?` печатает `[gate] зелено (fast): worfy/.:lint worfy/.:typecheck worfy/.:test` и код 0.
- [x] Намеренно сломанный unit test даёт `[gate] красно` и код 2; после отката снова зелено.
- [x] Test-файл, положенный в `.claude/worktrees/x/test/unit/`, не попадает в `pnpm test`.
- [x] PR тикета 01 (ветка `worfy-mvp/01`) показывает check CI зелёным: `gh pr checks <N>; echo $?` → код 0; в логе шага install нет «Ignored build scripts».
- [x] Намеренно сломанный unit test, запушенный в ту же ветку, делает check CI красным; после отката он снова зелёный. Ссылки на оба прогона — в «Итог».

## Тесты

- `test/e2e/launch.spec.ts` — smoke: окно открылось, заголовок и текст на месте (новый).
- `test/unit/paths.test.ts` — `paths.ts` уважает `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME` (новый).
- `test/unit/runtime.test.ts` — test-ы идут под Node из Electron (новый).
- `test/unit/dom-smoke.test.tsx` — рендер компонента в jsdom через `@testing-library/react` (новый).
- CI проверяется прогоном самого workflow на PR тикета 01 — зелёный, затем красный на сломанном unit test, затем снова зелёный; отдельного test-файла нет.
- Сначала падающий test: `launch.spec.ts` пишется до `src/main/index.ts` и падает на «приложение не собрано».

## Где в коде

- `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`, `playwright.config.ts`
- `src/main/index.ts`, `src/main/window.ts`, `src/main/storage/paths.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`
- `test/setup-dom.ts`, `test/e2e/helpers.ts`, `test/e2e/launch.spec.ts`
- `.gitignore`
- `.github/workflows/ci.yml` — минимальный CI (новый; тикет 32 его расширяет)
- `~/.claude/gate/config.json` — новая запись с ключом worfy (вне репозитория)

## Итог

PR: https://github.com/IDSAD-XL/worfy/pull/1 (ветка `worfy-mvp/01`).

**Сначала падающий test.** `test/e2e/launch.spec.ts` и `test/e2e/helpers.ts` написаны до `src/`.
`pnpm exec playwright test` упал с `The app is not built: …/out/main/index.js is missing`, а
`pnpm test:e2e` — на сборке: `An entry point is required in the electron vite main config`.
`pnpm test` до `src/` падал на `paths.test.ts` и `dom-smoke.test.tsx` (`Failed to resolve import
"../../src/renderer/main"`); `runtime.test.ts` проходил сразу — он проверяет запуск под Electron,
а не код.

**Проверки (локально, код возврата).**
- Чистый клон ветки: `pnpm install` → 0, «Ignored build scripts» в выводе нет; `pnpm build` → 0;
  `pnpm install --frozen-lockfile` → 0.
- `pnpm lint && pnpm typecheck && pnpm test` → 0 (3 файла, 8 test-ов).
- `pnpm test:e2e` → 0 без отдельного `pnpm build`. Правка текста в `src/renderer/main.tsx`
  (`worfy` → `worfy-changed`) дала красный следующий прогон `pnpm test:e2e` (код 1, test не нашёл
  текст «worfy»); после отката снова 0.
- `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh fast </dev/null` → `[gate] зелено (fast):
  worfy/.:lint worfy/.:typecheck worfy/.:test`, код 0. С намеренно сломанным `paths.test.ts` —
  `[gate] красно (fast): worfy/.:test (прошло: worfy/.:lint worfy/.:typecheck)`, код 2; после
  отката снова зелено, код 0.
- Test-файл `.claude/worktrees/x/test/unit/foreign.test.ts` с заведомо ложным `expect` не попал
  в `pnpm test` (по-прежнему 3 файла, код 0) и в `pnpm lint` (код 0); после проверки удалён.

**CI** (`.github/workflows/ci.yml`, job `check` на `macos-latest`):
- зелёный: https://github.com/IDSAD-XL/worfy/actions/runs/37253615168 — в логе install нет
  «Ignored build scripts», `pnpm test` скачал Electron и прошёл 8 test-ов;
- красный на намеренно сломанном unit test (коммит 166ae14):
  https://github.com/IDSAD-XL/worfy/actions/runs/37253715347 — `AssertionError: expected
  '/tmp/worfy-data' to be '/tmp/broken-on-purpose'`;
- снова зелёный после отката (коммит 0e151a8):
  https://github.com/IDSAD-XL/worfy/actions/runs/37253797465.

**Решения.**
- **pnpm 11 и `allowBuilds` вместо `pnpm.onlyBuiltDependencies`.** Тикет просил список в поле
  `pnpm` файла `package.json`. Локально и в `packageManager` стоит pnpm 11.22.0, а pnpm 11 это поле
  больше не читает (`[WARN] The "pnpm" field in package.json is no longer read by pnpm`) и падает с
  `ERR_PNPM_IGNORED_BUILDS`. Список перенесён в `pnpm-workspace.yaml` (настройка `allowBuilds`:
  `electron`, `esbuild`, `node-pty` — `true`, `electron-winstaller` — `false`, он нужен только
  для Windows). Поля `packages` в файле нет, поэтому репозиторий остаётся одним пакетом, а не
  workspace. Альтернатива — закрепить pnpm 10, где поле `pnpm` ещё работает; отвергнута: это
  откат на старую major-версию ради одного поля. Пакет со скриптом, которого нет в списке, теперь
  роняет `pnpm install`, а не пропускается молча. Файла `pnpm-workspace.yaml` нет в «Где в коде» —
  он нужен вместо поля `pnpm`.
- **Electron 44 скачивает бинарник при первом запуске**, а не в install-скрипте: у пакета
  `electron` 44.5.1 нет `scripts`. Поэтому в `allowBuilds` он стоит на всякий случай, а в CI
  строка «Downloading Electron binary...» появляется в шаге `pnpm test`.
- **Версии.** Самые новые, совместимые между собой: `vite` 7.3.6 (electron-vite 5.0.0 не
  поддерживает vite 8), `typescript` 6.0.3 (typescript-eslint 8.71 требует `<6.1`),
  `@vitejs/plugin-react` 5.2.0, `jsdom` 30.1.1 (30.1.2 вышел меньше суток назад, и pnpm 11 по
  умолчанию требовал для него исключение из `minimumReleaseAge`). Добавлен `@testing-library/dom`
  10.4.2 — обязательная peer-зависимость `@testing-library/react`.
- **Preload — CommonJS** (`out/preload/index.cjs`): окно создаётся с `sandbox: true`, а
  sandbox-preload не может быть ES-модулем. Остальное — ESM (`"type": "module"`).
- **`app.setPath('userData', dataRoot())`** в `src/main/index.ts`: собственные файлы Electron
  (кэш, local storage) ложатся в корень данных worfy, и e2e с временным `WORFY_DATA_DIR` ничего не
  оставляет в настоящем `~/Library/Application Support`.
- `paths.ts` превращает относительное значение `WORFY_DATA_DIR` / `WORFY_CLAUDE_HOME` в абсолютный
  путь, а пустое значение считает отсутствующим.
- `src/renderer/index.html` — вход renderer-а для electron-vite; в «Где в коде» его нет, без него
  сборки нет. `tsconfig.json` — только ссылки на `tsconfig.node.json` (main, preload, shared,
  `test/**/*.ts`, конфиги) и `tsconfig.web.json` (renderer, shared, `test/**/*.tsx`); общие
  опции — `tsconfig.base.json`. `pnpm typecheck` гонит `tsc --noEmit` по обоим.
- `main.tsx` экспортирует `App` и монтирует его, только если есть `#root`: так компонентный test
  рендерит тот же компонент, что и приложение.

**Запись Gate** в `~/.claude/gate/config.json` (вне репозитория, в PR её нет; копия файла до
правки сохранена, после правки `jq empty` → 0, остальные записи не изменились):

```diff
       "match": "/Users/alexey/Stuff/CanvasForAI",
       "profile": "worfy",
       "pm": "pnpm",
-      "_note": "Скриптов пока нет: package.json заводит тикет worfy-mvp/01. …",
-      "root": {},
-      "workspace": {}
+      "_note": "Один пакет pnpm без workspaces (тикет worfy-mvp/01): все скрипты корневые, workspace пустой. fast = lint typecheck test; full добавляет test:e2e (сборка + Playwright _electron). root_if — исходники TS/JS/CSS/HTML, package.json, tsconfig*, eslint*, pnpm-lock.yaml и pnpm-workspace.yaml (в нём allowBuilds).",
+      "root": {
+        "fast": ["lint", "typecheck", "test"],
+        "full": ["lint", "typecheck", "test", "test:e2e"]
+      },
+      "workspace": {},
+      "root_if": "\\.(ts|tsx|js|jsx|mjs|cjs|css|html)$|(^|/)package\\.json$|(^|/)tsconfig[^/]*\\.json$|(^|/)eslint[^/]*$|(^|/)pnpm-(lock|workspace)\\.yaml$"
```

В `root_if` сверх тикета добавлены `pnpm-lock.yaml` и `pnpm-workspace.yaml`: смена зависимостей
или списка `allowBuilds` должна прогонять проверки.

В CI `pnpm test:e2e` не гоняется — так задумано тикетом: e2e и сборку `.app` добавляет тикет 32.

**Доработка по ревью (круг 1).**
- **Граница процессов держится lint-правилом.** В `eslint.config.js` — локальное правило
  `worfy/process-boundary` для `src/renderer/**`, `src/card-runtime/**` и `src/shared/**`. Оно
  запрещает импорт `electron` (и `electron/*`), `node:*` и встроенных модулей Node без префикса
  (`fs/promises`, `path`, `os`…), а также относительные импорты, которые ведут в `src/main` и
  `src/preload` (для `src/shared` — ещё и в `src/renderer`). Ловит обычный и type-only импорт,
  `export … from`, `import()`, `typeof import(…)`, `require(…)`. Type-only импорт запрещён
  намеренно: один `import type … from 'electron'` подтягивает типы Node в `tsconfig.web.json`, и
  после этого `node:*` в renderer и shared проходят typecheck. Для `src/shared` запрещены все
  встроенные модули Node, а не только `node:fs`: `src/shared` входит в `tsconfig.web.json` с
  `types: []`, где модули Node и так не проходят typecheck, так что правило лишь говорит то же
  самое раньше и для любого импорта. Встроенное `no-restricted-imports` не выбрано: оно не
  разрешает относительный путь, и `../main` из подкаталога renderer (это `src/renderer/main.tsx`)
  нельзя отличить от `../../main` (это `src/main`).
- Правило проверено test-ом `test/unit/process-boundary.test.ts` (ESLint API над конфигом
  репозитория: 13 запрещённых импортов, 6 разрешённых). Файла нет в «Где в коде»: без него
  выключение правила ничем не ловится. Правило в `'off'` — 13 test-ов красные; сценарий ревью
  (`import { ipcRenderer } from 'electron'` в начале `src/renderer/main.tsx`) — `pnpm lint` код 1.
- `test/e2e/launch.spec.ts`: второй test сверяет `app.getPath('userData')` с `WORFY_DATA_DIR`
  (оба через `realpath`). С удалённой строкой `app.setPath('userData', …)` в `src/main/index.ts`
  `pnpm test:e2e` код 1 (`Received: …/Library/Application Support/Electron`), после отката — 0.
- `test/unit/paths.test.ts`: для `WORFY_CLAUDE_HOME` добавлены пустое и относительное значения.
  Мутант `override !== undefined` в `claudeHome` теперь даёт красный `pnpm test`.
