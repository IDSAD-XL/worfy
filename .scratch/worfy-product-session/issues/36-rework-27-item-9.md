# 36: Rework of worfy-product-session 27, item 9

Type: task
Status: claimed 2026-11-24T23:43Z
PR: #2185
Branch: worfy-product-session/36
Blocked by: None — can start immediately
Source: owner-check fail 2026-11-24 of worfy-product-session 27, item 9 — 27-кнопки-полосы-и-шапка-как-в-прототипе.md

**What to build:** the owner checked item 9 of worfy-product-session 27 on mac dev and it failed. In the words of the owner:

> Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); the Orchestrator saw on a dev build of 2e96e91ac: Real turn, 1160 px: panels 300 px, chat 333→229 px, one at a time; Critic, Drafts fine. Escape after reopening Agents did not close it; Idea generator showed «No idea generator in this Session yet» though the skill ran.

## Что происходит

После настоящего хода advisor-а: Esc после повторного открытия панели Agents её не закрывает; панель Idea generator показывает «No idea generator in this Session yet», хотя advisor запускал skill.

## Где в коде

Панели rail Product Session (Agents, Critic, Idea generator, Drafts): `src/renderer/product/` — обработчик Esc панели и источник списка запусков idea generator.

Уточнено при работе (2026-11-25): код панелей лежит не в `src/renderer/product/`, а в `src/renderer/session/`:

- `src/renderer/session/ProductSessionPanel.tsx` — Esc принимается на всей полосе (`<aside>`), а не только внутри панели:
  кнопка полосы после щелчка держит фокус, и Esc после «›» и повторного Agents шёл мимо панели.
- `src/renderer/session/product-agents.ts` (`ideasSkillRunOf`), `src/renderer/session/ProductRailPanels.tsx`
  (`IdeasPanel`), `src/renderer/session/SessionView.tsx` (`busy`) — советник запускает skill `worfy:product-ideas` в
  своём ходе (`harness/hooks/rules/product.md`), а не как Subagent; панель искала только Subagent-ы.
- `test/unit/product-session-panel.test.tsx`, `test/e2e/product-session.spec.ts`,
  `test/fixtures/agent-scripts/product-ideas-skill.jsonl`, `docs/features/product-session.md`,
  `.scratch/worfy-product-session/evidence/36-*.png`.

## Готово, когда

- [ ] Unit test: Esc с кнопки полосы, которая открыла панель (после «›» и повторного Agents), закрывает панель и
  оставляет фокус на кнопке; без открытой панели Esc уходит дальше.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/product-session-panel.test.tsx; red on origin/main) · mac - · c5d353861f92d609de9863d0dc5e181dd32d66e6
- [ ] Unit test-ы: Idea generator показывает запуск skill `worfy:product-ideas` в ходе советника — задание (аргументы
  skill-а или вопрос хода), состояние (working, пока ход идёт; done, error, interrupted) и последний ответ хода;
  `/worfy:product-ideas` владельца тоже считается; отказанный вызов Skill и другой skill — нет; из Subagent-а и запуска
  в чате показан более поздний.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/product-session-panel.test.tsx; red on origin/main) · mac - · c5d353861f92d609de9863d0dc5e181dd32d66e6
- [ ] e2e test (`test/e2e/product-session.spec.ts`, фейковый агент `product-ideas-skill.jsonl`): в окне 1160 px панель
  Idea generator показывает задание, «working», затем «done» и ответ; Agents, «›», снова Agents и Escape — панель
  закрыта, фокус на Agents.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 (red on origin/main code; red at the Escape step without the strip handler) · mac dev · 847a8677d76db03da09cc4c99fd8a20d7b9d0de8
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, e2e `test/e2e/product-session.spec.ts`, gate fast — exit 0.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · c5d353861f92d609de9863d0dc5e181dd32d66e6
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 · mac dev · 847a8677d76db03da09cc4c99fd8a20d7b9d0de8
  - evidence: gate pass · `gate fast` exit 0 · mac - · c5d353861f92d609de9863d0dc5e181dd32d66e6

- [ ] (вручную) Сделай: нажми по очереди Critic, Idea generator, Drafts, щёлкни черновик, потом ещё раз Drafts; затем Agents, «›», снова Agents и Escape → Должно быть: каждая кнопка открывает свою панель в колонке 300 px, чат сужается, но не закрыт; Critic — строка состояния с числом возражений, имя файла и отзыв; Idea generator — задание, состояние, ответ; Drafts — черновик хода, по щелчку его текст; повторный щелчок, «›» и Escape сворачивают; открыта одна панель.
  - needs: mac stable
  - evidence: screenshot pass · `../evidence/36-ideas-panel-1160-dark.png` · mac dev · 847a8677d · scrub: 2026-11-25
  - evidence: screenshot pass · `../evidence/36-ideas-panel-1160-light.png` · mac dev · 847a8677d · scrub: 2026-11-25
