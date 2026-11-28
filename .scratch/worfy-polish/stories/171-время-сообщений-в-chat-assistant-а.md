# Code story — worfy-polish 171: Время у сообщений во вкладке Chat панели Assistant

Kind: pr · Epic: worfy-polish · Ticket: 171 · PR: - · Language: ru

## 1. Что было не так

Во вкладке Chat панели Assistant у сообщений не было времени, хотя поле `at` у каждого сообщения уже есть в данных.
Chat Session время показывает своим форматом (`rowTime` в `Transcript.tsx`): `HH:MM` в 24 h, дата для другого дня,
полное время в tooltip-е. Владелец 2026-11-28: «добавь время сообщений у ассистента».

- Требование: [Что происходит](../issues/171-время-сообщений-в-chat-assistant-а.md#что-происходит)

## 2. Общий модуль: формат времени вынесен из Transcript

Code: `src/renderer/session/row-time.ts:43-52` · key lines: 44, 46, 50, 51

```ts
/** When a row happened (rowTime) against `now`; null without a time Date can hold. */
export function rowTimeOf(at: number | null, now: number): RowWhen | null {
  // A time Date cannot hold (out of its range) is shown as none rather than thrown on.
  return at === null || !Number.isFinite(new Date(at).getTime()) ? null : rowTime(at, now)
}

/** When a row happened (rowTime), against the transcript's today (NowContext). */
export function useRowTime(at: number | null): RowWhen | null {
  return rowTimeOf(at, useContext(NowContext))
}
```

- Что делает: `NowContext`, `useToday`, `rowTime` и `useRowTime` перенесены из `Transcript.tsx` без изменения формата.
  Новая `rowTimeOf` — проверка, что была внутри `useRowTime`, но с «сегодня» аргументом, а не из `NowContext`.
  Компонент `RowTime` лежит отдельно, в `RowTime.tsx`, и получил необязательный `className` (по умолчанию `w-tr__time`).
- Почему здесь: Ticket велит перенести `rowTime`, `useToday` и `RowTime` в общий модуль renderer-а. Два файла вместо
  одного `row-time.tsx`: правило eslint `react-refresh/only-export-components` не пускает hook-и и context в файл
  с компонентом. `rowTimeOf` нужна потому, что Ticket запрещает брать в Assistant `NowContext` с его default 0.
- Без него: Chat Assistant-а держал бы вторую копию формата, и форматы разошлись бы.
- Требование: [Что строить, п. 1 и 5](../issues/171-время-сообщений-в-chat-assistant-а.md#что-строить)
- Риски и пробелы test-ов: Transcript теперь импортирует эти имена; его test-ы (`session-view`, `product-transcript`)
  прошли без правок.

## 3. Chat: время под bubble, у ожидающего ответа — нет

Code: `src/renderer/assistant/AssistantPanel.tsx:392-398` · key lines: 395, 396

```tsx
                    </>
                  )}
                </div>
                {/* A pending answer's time is when the question went, not when it was answered: none until it comes. */}
                {message.state === 'pending' ? null : <MessageTime at={message.at} now={now} />}
              </div>
            </div>
```

- Что делает: у ответа Assistant-а время стоит под bubble внутри колонки `.w-asst-said`, кроме `pending`. У сообщения
  пользователя — так же, справа. `MessageTime` берёт «сегодня» из своего `useToday()` в `Chat` и рисует общий
  `RowTime` с классом `w-asst-time`.
- Почему здесь: Ticket называет компонент `Chat` в `AssistantPanel.tsx`. У `pending` поле `at` — время отправки, а не
  ответа (`send` в `view.ts`); когда ответ приходит, `answer` заменяет `at` временем ответа.
- Без него: под тремя точками стояло бы время вопроса, и после ответа оно сменилось бы.
- Требование: [Что строить, п. 2–4](../issues/171-время-сообщений-в-chat-assistant-а.md#что-строить)
- Риски и пробелы test-ов: вид в окне не снят — без Electron и e2e (правило брифа); это ручной пункт тикета.

## 4. Вид: колонка bubble и времени, avatar вровень с bubble

Code: `src/renderer/assistant/assistant.css:746-754` · key lines: 747, 748, 752, 753

```css
/* The date of another day stands on the time's line, before the clock (the transcript puts it on a line of its own). */
.w-asst-time .w-tr__date {
  display: inline;
  margin-right: 4px;
}
/* The avatar stays level with the bottom of the bubble, not with the time under it. */
.w-asst-message:has(.w-asst-time) > .w-asst-avatar {
  margin-bottom: 17px;
}
```

- Что делает: дата другого дня стоит в строке времени перед часами, а не отдельной строкой, как в transcript. Строка
  `.w-asst-message` выравнивает детей по низу; avatar поднят на высоту строки времени (14 px и зазор 3 px), чтобы
  стоять вровень с низом bubble. Предел ширины 88% перешёл с `.w-asst-bubble` на колонку `.w-asst-said`; у bubble
  внутри неё — `max-width: 100%` и `box-sizing: border-box` (раунд 2 review: без border-box padding и border
  добавлялись сверху, и bubble с широким code block выходил за край панели).
- Почему здесь: Ticket называет `assistant.css` рядом с `.w-asst-message` и `.w-asst-bubble`; 11 px, `--text-muted`
  и `tabular-nums` — из пункта 2 «Что строить». Отступ avatar-а и дата в одной строке — мой выбор, владелец его не
  записывал.
- Без него: avatar стоял бы вровень со строкой времени, а дата — над часами.
- Требование: [Что строить, п. 2](../issues/171-время-сообщений-в-chat-assistant-а.md#что-строить)
- Риски и пробелы test-ов: jsdom не считает раскладку; test в `assistant-panel.test.tsx` закрепляет только правила
  `box-sizing: border-box` у bubble и `min-width: 0` у колонки. `:has` есть в Chromium Electron, но вид проверяет только
  ручной пункт.

## 5. Test: pending без времени, failed со временем

Code: `test/unit/assistant-panel.test.tsx:545-551` · key lines: 547, 550

```tsx
  it('shows no time while the answer is being written, and the time of an answer that failed', () => {
    chat(message('m1', ASKED, 'assistant', 'pending'))
    expect(within(answer()).queryByTestId('transcript-time')).toBeNull()
    cleanup()
    chat(message('m1', ANSWERED, 'assistant', 'failed'))
    expect(within(answer()).getByTestId('transcript-clock').textContent).toBe('16:09')
  })
```

- Что делает: один из четырёх новых test-ов; часы подменены (`vi.useFakeTimers({ toFake: ['Date'] })`), времена заданы
  местными, поэтому ожидания не зависят от часового пояса. Соседние test-ы: 24 h у обеих сторон без даты, tooltip
  `YYYY-MM-DD HH:MM:SS`, дата другого дня (`Nov 23`) и другого года (`Dec 31 '25`).
- Почему здесь: Ticket называет `test/unit/assistant-panel.test.tsx` и эти проверки.
- Без него: время у `pending` никто бы не заметил до ручной проверки.
- Требование: [Test-ы](../issues/171-время-сообщений-в-chat-assistant-а.md#test-ы)
- Риски и пробелы test-ов: до правки четыре test-а были красными (4 failed из 35); первая проверка этого test-а
  (`pending` без времени) проходила и до правки, красной была вторая.

## 6. Что сознательно не меняли

`shortTime` во вкладках Waits, Summary и Journal остался прежним (п. 6 «Что строить»). Данные и main-процесс
(`window.ts`, `view.ts`) не тронуты: `at` там уже был.

## 7. Как проверено

До правки четыре новых test-а красные (`pnpm test test/unit/assistant-panel.test.tsx` — exit 1, 4 failed из 35), после —
exit 0. `pnpm test test/unit/assistant-panel.test.tsx test/unit/session-view.test.tsx test/unit/product-transcript.test.tsx`
— exit 0 (149 test-ов); `pnpm lint` и `pnpm typecheck` — exit 0. e2e и Electron локально не запускали (правило брифа).

## Проверить себя

1. Почему Chat не берёт «сегодня» из `NowContext`, как Transcript?
   - Ответ: вне провайдера Transcript `NowContext` даёт 0, и каждое сообщение считалось бы сообщением другого дня, с
     датой; Chat передаёт своё `useToday()` в `rowTimeOf`.
   - Строки: `src/renderer/session/row-time.ts:43-52`
2. Что увидел бы пользователь, если бы у `pending` время показывалось?
   - Ответ: под тремя точками — время вопроса, которое сменилось бы временем ответа, когда тот придёт.
   - Строки: `src/renderer/assistant/AssistantPanel.tsx:395-396`
