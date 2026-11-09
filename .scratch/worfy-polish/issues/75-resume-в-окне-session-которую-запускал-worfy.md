# 75 — Resume в read-only view Session, которую запускал worfy

Type: bug
Status: claimed 2026-11-09T08:44Z
PR: —
Branch: worfy-polish/75
Blocked by: —
Source: владелец 2026-11-09, Mac Stable: после перезапуска worfy Product Session, которую запускал сам worfy, не
работает; открытая из sidebar, она показана read-only со строкой «Read-only: started in terminal» и без способа
продолжить. Владелец решил, что Session потеряна. Строки перечитаны по main `6294e18ae`.

## Что происходит

Session Node, которую запускал worfy, хранит в data `origin: 'worfy'`, Vendor, `sessionId` и, у Product Session,
`kind: 'product'`. После перезапуска worfy процесса этой Session нет. Строка sidebar и двойной клик по Node открывают
её в Session view read-only (`nodeSession` в `src/renderer/session/navigation.ts`), то есть
`src/renderer/session/ExternalSessionPanel.tsx`. Панель написана для Session, запущенной вне worfy: всё, что не Claude
desktop, она называет terminal, и внизу пишет «Read-only: started in terminal». Это неправда, и кнопки Resume нет.

Сам Node на Canvas Resume предлагает (`src/renderer/canvas/nodes/SessionNode.tsx`), а `sessions.resume`
(`src/main/agent/node-sessions.ts`, `resume`) продолжает Session на Node, который её называет, с его Vendor и kind.

## Что делаем

- Панель находит Session Node worfy этой Session: Node с id из навигации, если его data — worfy и называет эту
  Session, иначе любой Session Node worfy в Layout Project-а, который её называет (палитра, notification и Work track
  открывают Session по id `session:<sessionId>`).
- Если такой Node есть и worfy эту Session сейчас не запускает, строка внизу — «Not running — Resume to continue», рядом
  кнопка Resume. В заголовке вместо «terminal · <cwd>» — «worfy · <cwd>».
- Resume вызывает `sessions.resume` с id Session — тот же путь, что у строки History и у Codex-Node: main сам находит Node,
  проверяет правило Resume (`src/main/agent/resume.ts`) и запускает Session с Vendor и kind Node. Product Session
  остаётся Product Session.
- Успех: Session view переходит на live view этого Node (`openSession` без `external`).
- Отказ (живой процесс держит transcript, нет transcript, папки нет): текст отказа main показан в строке, кнопка
  остаётся.
- На read-only экране (Linked machine с доступом только на чтение) Resume неактивна, с причиной, как на Node.
- Session, запущенная в terminal или в Claude desktop, и transcript Subagent-а — прежние строки.

## Готово, когда

- [ ] Session Node worfy, не запущенный, в Session view: строка «Not running — Resume to continue» и кнопка Resume.
  - evidence: test-run pass · `pnpm test test/unit/session-read-only-resume.test.tsx` exit 0 · mac - · c635b902bc8d9d14b7dd3c2f1e5fa4f41ebc76f8
  - evidence: test-run pass · `pnpm test:e2e test/e2e/new-product-session.spec.ts test/e2e/external-session.spec.ts test/e2e/session-picker.spec.ts test/e2e/subagent-tree.spec.ts` exit 0 · mac - · c635b902bc8d9d14b7dd3c2f1e5fa4f41ebc76f8
- [ ] Resume вызывает `sessions.resume` с `projectId` и id Session; при успехе view становится live view Node.
  - evidence: test-run pass · `pnpm test test/unit/session-read-only-resume.test.tsx` exit 0 · mac - · c635b902bc8d9d14b7dd3c2f1e5fa4f41ebc76f8
  - evidence: test-run pass · `pnpm test:e2e test/e2e/new-product-session.spec.ts test/e2e/external-session.spec.ts test/e2e/session-picker.spec.ts test/e2e/subagent-tree.spec.ts` exit 0 · mac - · c635b902bc8d9d14b7dd3c2f1e5fa4f41ebc76f8
- [ ] Отказ main виден в view.
  - evidence: test-run pass · `pnpm test test/unit/session-read-only-resume.test.tsx` exit 0 · mac - · c635b902bc8d9d14b7dd3c2f1e5fa4f41ebc76f8
- [ ] Session из terminal и из Claude desktop — прежние строки «Read-only: started in terminal» и «… in Claude desktop».
  - evidence: test-run pass · `pnpm test test/unit/session-read-only-resume.test.tsx` exit 0 · mac - · c635b902bc8d9d14b7dd3c2f1e5fa4f41ebc76f8
  - evidence: test-run pass · `pnpm test:e2e test/e2e/new-product-session.spec.ts test/e2e/external-session.spec.ts test/e2e/session-picker.spec.ts test/e2e/subagent-tree.spec.ts` exit 0 · mac - · c635b902bc8d9d14b7dd3c2f1e5fa4f41ebc76f8
- [ ] Страница `docs/features/transcripts-and-usage.md` (и перевод в `docs/features/ru/`) говорит об этом.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · c635b902bc8d9d14b7dd3c2f1e5fa4f41ebc76f8

## Тесты

- `test/unit/session-read-only-resume.test.tsx` — новый: выбор строки (worfy не запущен → Resume; terminal; desktop;
  Subagent) и Resume, который зовёт `sessions.resume` с id Session и переходит на live view; отказ виден.
- e2e: `test/e2e/new-product-session.spec.ts` — Product Session Node, сохранённый до запуска worfy, открывается
  read-only с Resume, Resume переводит view в live, Node остаётся `kind: 'product'`.
- Прогнать e2e рядом с панелью без правок: `test/e2e/external-session.spec.ts`, `test/e2e/session-picker.spec.ts`,
  `test/e2e/subagent-tree.spec.ts`.

## Где в коде

- `src/renderer/session/ExternalSessionPanel.tsx` — строка, источник в заголовке, кнопка Resume.
- `src/renderer/session/read-only-line.ts` — новый: выбор строки и Node worfy для Session.
- `test/unit/session-read-only-resume.test.tsx` — новый.
- `test/e2e/new-product-session.spec.ts` — новый test.
- `docs/features/transcripts-and-usage.md`, `docs/features/ru/transcripts-and-usage.md` — абзац «Read-only view».
- `src/main/agent/node-sessions.ts`, `src/main/agent/resume.ts`, `src/renderer/session/navigation.ts`,
  `src/renderer/canvas/nodes/SessionNode.tsx` — только читаются.
