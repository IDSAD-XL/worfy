# 01 — Каркас репозитория: пустое приложение собирается, тестируется и проходит gate.sh fast

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), разделы «Как устроено» и «Соглашения для тикетов этого эпика»; [ADR-0004](../../../docs/adr/0004-stack-electron-ts-react-flow-agent-sdk.md)

## Что делаем

Репозиторий пуст: `README.md`, `.gitignore`, `CONTEXT.md`, `docs/`, `HANDOFF.md` (его завёл
оркестратор вместе с эпиком). Нужен каркас, на котором остальные тикеты эпика пишут код и сразу
проверяются тем же Gate (`~/.claude/hooks/gate.sh`, проверка готовности изменений), что и в
других проектах. CI на GitHub, сборка `.app` и нативный `node-pty` — тикет 32.

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

## Тесты

- `test/e2e/launch.spec.ts` — smoke: окно открылось, заголовок и текст на месте (новый).
- `test/unit/paths.test.ts` — `paths.ts` уважает `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME` (новый).
- `test/unit/runtime.test.ts` — test-ы идут под Node из Electron (новый).
- `test/unit/dom-smoke.test.tsx` — рендер компонента в jsdom через `@testing-library/react` (новый).
- Сначала падающий test: `launch.spec.ts` пишется до `src/main/index.ts` и падает на «приложение не собрано».

## Где в коде

- `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`, `playwright.config.ts`
- `src/main/index.ts`, `src/main/window.ts`, `src/main/storage/paths.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`
- `test/setup-dom.ts`, `test/e2e/helpers.ts`, `test/e2e/launch.spec.ts`
- `.gitignore`
- `~/.claude/gate/config.json` — новая запись с ключом worfy (вне репозитория)
