# 01 — Каркас репозитория: пустое приложение собирается, тестируется и проходит gate.sh fast

Type: task
Status: open
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

- [ ] `pnpm install && pnpm build` → код 0 на чистом клоне; в выводе `pnpm install` нет «Ignored build scripts».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` → код 0.
- [ ] `pnpm test` идёт под Electron: test `runtime.test.ts` видит `process.versions.electron`.
- [ ] Компонентный test `*.test.tsx` рендерит React-компонент в jsdom и проходит в `pnpm test`.
- [ ] `pnpm test:e2e` → код 0 без отдельного `pnpm build`: smoke test запускает приложение, видит окно с текстом «worfy» и закрывает его; правка текста в `src/renderer/main.tsx` видна следующему прогону.
- [ ] `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh fast </dev/null; echo $?` печатает `[gate] зелено (fast): worfy/.:lint worfy/.:typecheck worfy/.:test` и код 0.
- [ ] Намеренно сломанный unit test даёт `[gate] красно` и код 2; после отката снова зелено.
- [ ] Test-файл, положенный в `.claude/worktrees/x/test/unit/`, не попадает в `pnpm test`.
- [ ] PR тикета 01 (ветка `worfy-mvp/01`) показывает check CI зелёным: `gh pr checks <N>; echo $?` → код 0; в логе шага install нет «Ignored build scripts».
- [ ] Намеренно сломанный unit test, запушенный в ту же ветку, делает check CI красным; после отката он снова зелёный. Ссылки на оба прогона — в «Итог».

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
