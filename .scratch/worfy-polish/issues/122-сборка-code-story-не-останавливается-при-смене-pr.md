# 122 — Сборка Code story кнопкой не останавливается при смене PR или view, и её статус виден по возвращении

Type: bug
Status: claimed 2026-11-17T00:38Z
Blocked by: none
Source: баг-репорт владельца 2026-11-17 (Pull requests, кнопка «Code story» из `worfy-code-stories` 11).

Кто: агент.

## Что происходит

Владелец: открыть PR A в Pull requests, нажать «Code story» (сборка Code story кнопкой, `worfy-code-stories` 11).
Пока она идёт — переключиться на PR B (и, возможно, обратно на A). Ожидается: PR A показывает, что его story
собирается, пока сборка не закончится или не упадёт; PR B показывает своё состояние. На деле статус пропадает.
Владелец спрашивает также: переживает ли сборка переключение, ложится ли её результат на PR A, а не на открытый
сейчас PR; можно ли запустить вторую сборку A, пока идёт первая (кнопка возвращается); то же после reload окна.

Факты (main на 70f08556c):

- Кнопка в Pull requests — с `key` на PR: `src/renderer/pr-inbox/PrInboxView.tsx:510-519`
  (`${repo}#${number}`), поэтому смена PR размонтирует её.
- `useStoryBuild` останавливает сборку при размонтировании (`stories.stop`): `src/renderer/stories/story-build.ts:6-7`,
  `:51-58` — правило аудита PR #1890 («сборку, которую никто не ждёт, останавливают, чтобы её платный запрос не шёл
  до конца»). Значит, смена PR сегодня молча ОТМЕНЯЕТ сборку; вернувшись, кнопка снова «Code story», и второе нажатие
  начинает новый платный запрос.
- На Canvas (Epic frame, Ticket card: `src/renderer/canvas/actions/EpicStory.tsx`, `TicketStory.tsx`) view не
  размонтируется при переключении (`src/renderer/shell/AppShell.tsx:119-136`, `hidden`), но Popover бара закрывается
  на смене view (`src/renderer/theme/kit/layer.ts:101`), и `onOpenChange(false)` зовёт `stop()`
  (`src/renderer/stories/StoryBuildButton.tsx`); Esc в баре — тоже Stop. То есть смена view останавливает и сборку на
  Canvas.
- Результат кладётся под ключ самой сборки: `src/main/stories/by-button.ts` (`storyKeyOf`, `saveStory(…, key, …)`) —
  от открытого view он не зависит.

## Решение

Ожидание владельца отменяет правило #1890 для этого случая: сборка, начатая кнопкой, идёт до конца, какой бы view ни
был открыт; останавливает её только явный Stop (и выход из приложения).

## Что делаем

1. **main: реестр идущих сборок кнопкой** по Project и ключу story (`owner/name#N`, `epic:<name>`; Ticket card строит
   story своего PR, ключ тот же). Канал чтения `stories.running` (Project и target → идущая сборка: `storyId`, ключ,
   последние строки) — для кнопки, которая появилась заново. `stories.make` для ключа, который уже собирается, не
   начинает второй платный запрос: присоединяется к идущей сборке (её строки, её ответ). Конец каждой своей сборки
   main сообщает событием `stories.made` окну, которое её начало.
2. **renderer: кнопка не останавливает сборку при уходе.** Размонтирование не зовёт `stories.stop`. На монтировании
   кнопка спрашивает `stories.running` для своего target и показывает бар той сборки (строки — `stories.activity`,
   конец — `stories.made`). На Canvas смена view и Esc закрывают бар, сборка идёт; бар возвращается на Canvas и по
   нажатию кнопки.
3. **Toast** «The Code story of <PR/Epic> is ready» с «Open», когда сборка кончилась, а её кнопки нет на экране
   (ни одна смонтированная кнопка её не ведёт): toast ticket 10 (`story-toast.ts`) — только для Epic `story.md`,
   поэтому берётся общий `showToast` с тем же видом.
4. Reload окна: тот же путь — реестр main переживает reload renderer-а.
5. Новые каналы — в IpcContract (`src/shared/ipc/stories.ts`) и в список доступа link (`test/unit/link-access.test.ts`).
6. `docs/features/code-stories.md` — абзац о баре и об остановке.

## Готово, когда

- [ ] Contract test реестра main (сначала красный): два ключа собираются параллельно; второй `make` того же ключа не
      начинает второго агента; результат сохранён под своим ключом при другой открытой сборке; Stop останавливает только
      свою сборку.
- [ ] Unit test-ы кнопки (сначала красные): размонтирование не зовёт `stories.stop`; монтирование при идущей сборке
      своего ключа показывает бар; идущая сборка другого ключа не показывается.
- [ ] e2e в `test/e2e/code-story.spec.ts` (fake agent; локальный e2e запрещён, CI его прогоняет): сборка на PR A,
      переход на B (B без бара), обратно на A (бар на месте), конец → story открыта и сохранена у A; reload — если
      выполнимо.
- [ ] Все unit- и contract-test-ы модуля stories, `pnpm lint`, `pnpm typecheck`, gate fast — exit 0; `ci-ok` на PR.
- [ ] `docs/features/code-stories.md` описывает новое поведение.

## Где в коде

- `src/main/stories/by-button.ts` (реестр, присоединение, `running`)
- `src/main/ipc/stories.ts` (handler-ы `stories.running`, событие `stories.made`)
- `src/shared/ipc/stories.ts` (каналы)
- `src/renderer/stories/story-build.ts` (без `stories.stop` при размонтировании, ведение идущей сборки, комментарий
  `:6`)
- `src/renderer/stories/StoryBuildButton.tsx` (бар идущей сборки, Popover на смене view и Esc)
- `src/renderer/stories/use-story-toasts.ts` (toast готовой story)
- `test/contract/story-by-button.test.ts`, `test/contract/stories-handler.test.ts`
- `test/unit/story-progress.test.tsx`, `test/unit/story-entries.test.tsx`, `test/unit/link-access.test.ts`
- `test/e2e/code-story.spec.ts`
- `docs/features/code-stories.md`

## Вне скоупа

- `stories.build` (сборка по готовому материалу, `start`) — её держит только renderer, ключа и реестра у неё нет:
  правило #1890 для неё остаётся.
- Вид бара и кнопки — по F-SPEC и kit, не меняется.
