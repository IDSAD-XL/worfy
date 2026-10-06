# 22 — Session view и Node после Resume показывают прошлые ходы

Type: task
Status: blocked — blocked by 06, 07, 08, 09
Blocked by: 06, 07, 08, 09
Source: [spec.md](../spec.md), тема C; ручная проверка 2026-10-06, ночь — Ticket 18 worfy-mvp (`.scratch/worfy-mvp/issues/18-новая-сессия-история-resume.md:191`); HANDOFF, «Риски и долги»

## Что делаем

**Дефект.** Session, продолженная через Resume, пишет в тот же транскрипт, и Claude Code помнит
прежние ходы. worfy их не показывает:

- Session view показывает только ходы после Resume. Ходов из терминала нет ни в DOM, ни при
  прокрутке.
- Node Session сразу после Resume показывает «No answer yet», а не последний ответ из транскрипта.

**Причина.** Session view берёт события только из живого потока: `useSessionLog`
(`src/renderer/session/SessionView.tsx:101`). Store прошлые ходы не подгружает: «after a restart the
view starts empty» (`src/renderer/session/store.ts:17`). Node берёт последний ответ из того же
живого лога (`src/renderer/canvas/nodes/SessionNode.tsx:131-132`), отсюда «No answer yet» (`:252`).
По той же причине Orchestrator после перезапуска worfy показывает пустой транскрипт.

**Правка.** View Session worfy, у которой уже есть транскрипт, показывает сначала события из
транскрипта, потом живые.

- Прошлые события читаются так же, как у read-only Session: `useSessionTranscript`
  (`src/renderer/claude-home/useClaudeHome.ts:257`), его уже берёт
  `src/renderer/session/ExternalSessionPanel.tsx:45`. Это те же события worfy
  (`src/shared/transcript/parse.ts`), и один `Transcript` рисует оба вида. `useClaudeHome.ts` не
  меняется.
- Прошлая часть — ходы до Resume, дальше — живой поток. Ход не показывается дважды: Session
  дописывает транскрипт во время хода, а живой поток несёт тот же ход.
- Пока живого ответа нет, Node Session показывает последний ответ из прошлой части.
- Где склеиваются две части — в store или во view, — решает Ticket. Выбор — в «Итог».

worfy только читает транскрипт ([ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md)).

## Готово, когда

- [ ] Resume Session Node-а над транскриптом из двух ходов: Session view сразу показывает оба прошлых хода, потом новый. e2e читает строки транскрипта в DOM, каждый ход ровно один раз.
- [ ] Node Session сразу после Resume показывает последний ответ из транскрипта, а не «No answer yet»: e2e читает `session-node-answer`.
- [ ] Ход, который уже есть и в транскрипте, и в живом потоке, показан один раз: unit-test склейки на двух списках событий с общим ходом.
- [ ] Orchestrator после перезапуска worfy показывает прошлые ходы своей Session: e2e перезапускает приложение с тем же `WORFY_DATA_DIR`, транскрипт сохранённой Session лежит во временном `WORFY_CLAUDE_HOME`.
- [ ] Дерево временного `WORFY_CLAUDE_HOME` до и после e2e совпадает.
- [ ] Снимки Session view после Resume в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/session-resume.spec.ts` (новый) — Resume Session Node-а над фикстурой транскрипта, `WORFY_AGENT=fake`; перезапуск с Orchestrator-ом.
- `test/unit/session-log-resume.test.ts` (новый) — склейка прошлых и живых событий без повторов.
- Сначала падающий test: e2e после Resume ищет в Session view текст первого хода фикстуры и не находит.

## Где в коде

- `src/renderer/session/SessionView.tsx`
- `src/renderer/session/store.ts`
- `src/renderer/canvas/nodes/SessionNode.tsx`
- `test/unit/session-log-resume.test.ts` (новый)
- `test/e2e/session-resume.spec.ts` (новый)
