# 122 — Сборка Code story кнопкой не останавливается при смене PR или view, и её статус виден по возвращении

Type: bug
Status: done 2026-11-17T03:47Z
PR: #1940
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
  - evidence: test-run pass · `pnpm test test/contract/story-by-button.test.ts test/contract/stories-handler.test.ts` exit 0 · mac - · a64866be4d71a7d5c6b5b4689c6f36f5a673dcf1
  - evidence: test-run pass · `pnpm test test/contract/story-by-button.test.ts test/contract/stories-handler.test.ts` exit 0 · mac - · 930bf9a80d2d65eadaa936d553a6e99a7a634127
- [ ] Unit test-ы кнопки (сначала красные): размонтирование не зовёт `stories.stop`; монтирование при идущей сборке
      своего ключа показывает бар; идущая сборка другого ключа не показывается.
  - evidence: test-run pass · `pnpm test test/unit/story-build-button.test.tsx` exit 0 · mac - · a64866be4d71a7d5c6b5b4689c6f36f5a673dcf1
  - evidence: test-run pass · `pnpm test test/unit/story-build-button.test.tsx` exit 0 · mac - · 930bf9a80d2d65eadaa936d553a6e99a7a634127
- [ ] e2e в `test/e2e/code-story.spec.ts` (fake agent; локальный e2e запрещён, CI его прогоняет): сборка на PR A,
      переход на B (B без бара), обратно на A (бар на месте), конец → story открыта и сохранена у A; reload — если
      выполнимо.
- [ ] Все unit- и contract-test-ы модуля stories, `pnpm lint`, `pnpm typecheck`, gate fast — exit 0; `ci-ok` на PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · a64866be4d71a7d5c6b5b4689c6f36f5a673dcf1
  - evidence: gate pass · `gate fast` exit 0 · mac - · 930bf9a80d2d65eadaa936d553a6e99a7a634127
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44004855517/job/133795843818 · ci - · aa6f1fbdeaea10713e5dccf81d7735fadead73db
- [ ] `docs/features/code-stories.md` описывает новое поведение.
  - evidence: commit pass · Keep a Code story build by the button running when its PR or view is left (worfy-polish 122) · - - · a64866be4d71a7d5c6b5b4689c6f36f5a673dcf1

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

## Итог

- **Решение владельца (2026-11-17), записано здесь и в комментарии `src/renderer/stories/story-build.ts:6`:** сборка,
  начатая кнопкой «Code story», идёт до конца, какой бы view ни был открыт; останавливает её только явный Stop (и выход
  из приложения). Для этих сборок оно отменяет правило аудита PR #1890 («сборку, которую никто не ждёт, останавливают»).
- **main** (`src/main/stories/by-button.ts`): реестр `byKey` идущих сборок по Project и ключу story. `stories.running`
  (канал чтения, `project`/`read`) называет сборку target-а; `stories.make` того же ключа присоединяется к идущей
  сборке — её строки, её ответ, Stop под его storyId останавливает её, второго запроса нет. Конец своей сборки main
  шлёт окну событием `stories.made` (`project`/`read`), когда записи в реестре уже нет. Story сохраняется под ключом
  самой сборки — от открытого view не зависит.
- **renderer**: размонтирование кнопки больше не зовёт `stories.stop` для сборки кнопкой; на монтировании (и для кнопки
  на Canvas — когда Canvas снова показан) кнопка спрашивает `stories.running` и показывает бар той сборки. Reload окна
  идёт тем же путём: main шлёт события тому же `webContents`.
- **Toast**: «The Code story of PR owner/name#N is ready» / «of Epic <name>» с «Open», когда сборка кончилась, а её
  кнопка не на экране. Toast Ticket-а 10 (`story-toast.ts`) — для `story.md` Epic-а из модели workflow, раз на Epic в
  localStorage, — не подошёл: это свой `action` toast через общий `showToast`.
- Решено без владельца, подтвердить:
  1. **Esc в баре на Canvas** раньше останавливал сборку (так было и в `docs/features/code-stories.md`). Теперь Esc, как
     и смена view, только закрывает бар; бар возвращается с Canvas или по нажатию кнопки. Причина: «только явный Stop».
  2. **`stories.build` (`start`)** — сборка по готовому материалу без ключа в main; правило #1890 для неё остаётся. В
     приложении её зовут только test-ы.
  3. **Code story этого PR** (`.scratch/worfy-polish/stories/122-…md`): `story-check` отвергает заголовок
     `Ticket: 122` — формат (`harness/bin/TICKETS.md`, `src/shared/stories/schema.ts`) знает только двузначные номера
     Ticket-ов. Всё остальное в story зелёное (4 фрагмента сходятся с кодом). Чинить формат — вне этого Ticket-а.
  4. Перевод `docs/features/ru/code-stories.md` тоже поправлен: он прямо говорил, что Esc и уход останавливают сборку.
- Review round 1 (REJECTED, обе линзы), исправлено во втором раунде:
  - строки (`stories.activity`) и конец (`stories.made`) сборки кнопкой идут всем клиентам приложения
    (`toEveryWindow`), а не только окну, которое нажало: окно, закрытое и открытое заново из Dock, и Linked machine,
    подхватившие сборку через `stories.running`, слышат её до конца;
  - сборка, которая кончилась «Failed» или «Not available», пока её кнопки нет на экране, даёт error toast с причиной;
  - hook слушает `stories.made` с монтирования, а не с отрисовки бара: конец сразу после ответа `stories.running` не
    теряется.
- CI второго раунда (e2e Autopilot, Run оставался «stopping»): `stories.running` создавал maker story, а с ним
  release-ы fake agent-а для story, которые забирали `globalThis.worfyFakeRelease` у fake agent-а Session-ов. Теперь
  без maker-а `stories.running` отвечает null и maker не создаёт; regression — contract test в
  `test/contract/stories-handler.test.ts`.
- Оставлено как есть (low): удаление Project-а больше не останавливает его сборку кнопкой — платный запрос идёт до
  конца, папка данных Project-а при удалении остаётся (`src/main/projects/store.ts`), так что story просто сохраняется.
