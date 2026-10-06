# 22 — Session view и Node после Resume показывают прошлые ходы

Type: task
Status: done — 2026-10-06, [PR #51](https://github.com/IDSAD-XL/worfy/pull/51)
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

- [x] Resume Session Node-а над транскриптом из двух ходов: Session view сразу показывает оба прошлых хода, потом новый. e2e читает строки транскрипта в DOM, каждый ход ровно один раз.
- [x] Node Session сразу после Resume показывает последний ответ из транскрипта, а не «No answer yet»: e2e читает `session-node-answer`.
- [x] Ход, который уже есть и в транскрипте, и в живом потоке, показан один раз: unit-test склейки на двух списках событий с общим ходом.
- [x] Orchestrator после перезапуска worfy показывает прошлые ходы своей Session: e2e перезапускает приложение с тем же `WORFY_DATA_DIR`, транскрипт сохранённой Session лежит во временном `WORFY_CLAUDE_HOME`.
- [x] Дерево временного `WORFY_CLAUDE_HOME` до и после e2e совпадает. Оговорка: кроме файлов, которые записал сам test.
- [x] Снимки Session view после Resume в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/session-resume.spec.ts` (новый) — Resume Session Node-а над фикстурой транскрипта, `WORFY_AGENT=fake`; перезапуск с Orchestrator-ом.
- `test/unit/session-log-resume.test.tsx` (новый) — склейка прошлых и живых событий без повторов.
- Сначала падающий test: e2e после Resume ищет в Session view текст первого хода фикстуры и не находит.

## Где в коде

- `src/renderer/session/SessionView.tsx`
- `src/renderer/session/store.ts`
- `src/renderer/canvas/nodes/SessionNode.tsx`
- `test/unit/session-log-resume.test.tsx` (новый)
- `test/e2e/session-resume.spec.ts` (новый)

## Итог

Ветка `worfy-daily/22`, [PR #51](https://github.com/IDSAD-XL/worfy/pull/51), без ADR и миграций. Один круг доработки: prompt с картинкой показывался дважды, прерванный prompt поглощался склейкой.

- **Session view** (`src/renderer/session/SessionView.tsx`). worfy-Session, у которой уже есть файл транскрипта, показывает сначала ходы транскрипта, потом живые события. Это Session после Resume на своём Node-е или сохранённая Session Orchestrator-а после перезапуска worfy. Прошлое читается `useSessionTranscript`, тем же hook-ом, что у просмотра только для чтения. Id транскрипта — `sdkSessionId` Node-а, у Orchestrator-а — `sessionId` из данных его Node-а.
- **Где склеиваются части — в store**: `joinPastAndLive` в `src/renderer/session/store.ts`. Session пишет транскрипт во время хода, поэтому живая часть начинается в файле с первого события, чей id есть и в живых событиях (id сообщения, tool use, tool result, task). Оттуда склейка отступает назад к prompt-у или slash-команде, с которых начинаются живые события, если такой лежит между этой точкой и последним событием с id. Prompt-ы сравниваются без строк `Attached …` (`typedText`): живой prompt называет свои картинки, а транскрипт шлёт их отдельными блоками. Отступ останавливается на любом prompt-е, с которого живые события не начинаются, в том числе на `[Request interrupted by user]` Claude Code, и берёт каждый живой prompt один раз. Прошлый prompt, у которого уже есть ответ или который закрыло прерывание, остаётся, даже если пользователь снова набрал тот же текст. `acceptAgentEvent` не менялся.
- **Session Node** (`src/renderer/canvas/nodes/SessionNode.tsx`). Пока у идущей Session нет живого ответа, Node показывает последний ответ из транскрипта. Он читает транскрипт один раз через `claudeHome.transcript`, а не `useSessionTranscript`. Этот hook держит один общий state на транскрипт; Session view той же Session пользуется им одновременно, и кто размонтируется первым, удалил бы state у другого.
- Ключи строк транскрипта считаются назад от первого живого события: живые строки сохраняют ключи, пока прошлая часть растёт или сжимается.
- **Принятый пробел.** Prompt до Resume без ответа и без записи прерывания, с тем же текстом, что первый живой prompt, в файле от него не отличить: он показывается один раз. Это поведение закреплено unit-test-ом.
- **Test-ы.** `test/unit/session-log-resume.test.tsx` — склейка на списках событий с общим ходом: ход целиком, только prompt, ход, записанный частично, ход без ответа, slash-команда, лишнее событие после prompt-а, прошлый ход с тем же prompt-ом, живые события, обрезанные в начале, prompt с картинками, prompt с файлами, прерванный прошлый prompt, повторённые prompt-ы. Расширение `.tsx`, потому что tsconfig node-test-ов не импортирует модули renderer.
- `test/e2e/session-resume.spec.ts`: (1) Resume над транскриптом из двух ходов — ответ Node-а берётся из транскрипта, Session view показывает оба хода, потом новый; после того как новый ход дописан в файл так, как пишет Claude Code, каждый ход по-прежнему виден один раз. (2) Перезапуск приложения с тем же `WORFY_DATA_DIR` — Orchestrator показывает ходы сохранённой Session. В обоих test-ах дерево `WORFY_CLAUDE_HOME` не меняется, кроме файлов, которые записал сам test; снимки в светлой и тёмной теме приложены к выводу test-а.
- Мутанты: склейка, заменённая простой конкатенацией, роняет 7 unit-test-ов и e2e Resume. Без `typedText`, без остановки на чужом prompt-е или без счёта живых prompt-ов падает по одному unit-test-у.
- Снимки проверяющего после круга доработки: Session view после Resume — [22-session-view-after-resume-light.png](../evidence/22-session-view-after-resume-light.png), [22-session-view-after-resume-dark.png](../evidence/22-session-view-after-resume-dark.png); ход с картинкой — [22-session-view-image-turn-light.png](../evidence/22-session-view-image-turn-light.png), [22-session-view-image-turn-dark.png](../evidence/22-session-view-image-turn-dark.png); прошлый ответ в Node — [22-node-past-answer-light.png](../evidence/22-node-past-answer-light.png), [22-node-past-answer-dark.png](../evidence/22-node-past-answer-dark.png).
