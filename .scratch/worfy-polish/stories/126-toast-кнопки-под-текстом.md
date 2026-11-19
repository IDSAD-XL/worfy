# Code story — worfy-polish 126: Toast с кнопками: кнопки под текстом, текст не сжимается

Kind: pr · Epic: worfy-polish · Ticket: 126 · PR: - · Language: ru

## 1. Что было не так

Toast был одной flex-строкой: текст, кнопки действий, ×. Текст стоял с `flex: 1; min-width: 0`, кнопки — с
`flex: none`, а ширина области — не больше 360 px. У toast-а обновления «worfy … ready» три кнопки (Restart when idle,
Restart now, Later) забирали почти всю ширину, тексту оставались считанные пиксели, и он переносился по одной-две буквы:
«worf / y / 0…».

- Требование: [Что происходит](../issues/126-toast-кнопки-под-текстом.md#что-происходит)

## 2. Кнопки действий получают свою строку в разметке

Code: `src/renderer/toast/ToastRegion.tsx:90-98` · key lines: 90, 91

```tsx
      {toast.actions !== undefined && toast.actions.length > 0 && (
        <div className="w-toast__actions">
          {toast.actions.map((action, index) => (
            <button key={index} type="button" className="w-toast__action" onClick={() => closing(() => pressToastAction(id, index))}>
              {action.label}
            </button>
          ))}
        </div>
      )}
```

- Что делает: кнопки действий собраны в обёртку `.w-toast__actions`; у toast-а без кнопок обёртки нет вовсе. Обёртка
  стоит в документе между текстом и ×, как раньше стояли сами кнопки.
- Почему здесь: Ticket называет `ToastRegion.tsx` среди своих файлов; порядок в документе — это порядок Tab, и Ticket
  просит его сохранить (кнопки, затем ×).
- Без него: кнопки остаются отдельными ячейками одной строки рядом с текстом, и CSS не может поставить их строкой под
  текстом, не трогая ×.
- Требование: [Что делаем, п. 1–3](../issues/126-toast-кнопки-под-текстом.md#что-делаем)
- Риски и пробелы test-ов: unit test проверяет обёртку, её отсутствие и порядок кнопок в документе; jsdom не считает
  раскладку, поэтому сам вид проверен снимками Playwright вне репозитория.

## 3. Сетка: текст и × в первой строке, кнопки — во второй

Code: `src/renderer/toast/toast.css:32-38` · key lines: 34, 35

```css
.w-toast {
  --toast-accent: var(--border-strong);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--space-2);
  row-gap: var(--space-1);
```

- Что делает: toast — сетка из двух колонок. Первая колонка — текст, она забирает всю ширину, кроме ×. Нулевой минимум в
  `minmax(0, 1fr)` здесь только страховка: длинное слово колонку не распирает и при простом `1fr`, потому что у текста
  `overflow: hidden` и `overflow-wrap: anywhere` (`src/renderer/toast/toast.css:74-75`). Страховка срабатывает, если
  эти две строки уберут: тогда с `1fr` слово из 200 букв расширяет колонку до 1324 px и выталкивает × за правый край
  toast-а, а с `minmax(0, 1fr)` колонка остаётся 308 px.
- Почему здесь: Ticket называет `toast.css`; почему сетка, а не перенос flex-строки, — не записано, это выбор
  implementer-а: сетка ставит × в первую строку при любом порядке в документе.
- Без него: обёртка кнопок осталась бы ячейкой flex-строки и снова сжимала бы текст.
- Требование: [Что делаем, п. 1–2](../issues/126-toast-кнопки-под-текстом.md#что-делаем)
- Риски и пробелы test-ов: unit test проверяет только, что в CSS есть `display: grid`; высота toast-а растёт на строку
  кнопок, а размещение стопки меряет её (`region.scrollHeight` в `ToastRegion.tsx`) — отдельного test-а на более
  высокий toast нет.

## 4. Строка кнопок — на всю ширину, под текстом и ×

Code: `src/renderer/toast/toast.css:80-87` · key lines: 81, 82

```css
.w-toast__actions {
  grid-row: 2;
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-1) var(--space-2);
}
```

- Что делает: обёртка кнопок встаёт во вторую строку и занимает обе колонки; кнопки прижаты к правому краю, а те, что
  не влезли в строку, переносятся на следующую. Текст и × явно поставлены в первую строку (`grid-row: 1`), поэтому
  обёртка, стоящая в документе раньше ×, не занимает её место.
- Почему здесь: Ticket, п. 1: × остаётся справа в первой строке. Прижатие кнопок вправо — не записано.
- Без него: × остаётся справа в первой строке — его место задаёт `src/renderer/toast/toast.css:105-106`. Обёртка всё
  равно уходит во вторую строку (сетка ставит её в первую свободную ячейку), но только в первую колонку, 308 px вместо
  340: кнопки прижаты к левому краю, стоят вплотную, без промежутков, и переносятся как обычный текст, а не по правилу
  `flex-wrap`.
- Требование: [Что делаем, п. 1](../issues/126-toast-кнопки-под-текстом.md#что-делаем)
- Риски и пробелы test-ов: перенос кнопок, когда они не влезают в 360 px, ни один test не проверяет; у нынешних
  вызывающих (не больше трёх коротких кнопок) он не нужен.

## 5. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — exit 0. Новый test в
`test/unit/toasts-view.test.tsx` был красным до правки (`expected null not to be null`), после — зелёный. `pnpm build` —
exit 0. Снимки Playwright (страница Vite с настоящими `ToastRegion` и `tokens.css`, светлая и тёмная тема): toast «worfy
0.5.0 ready» с тремя кнопками — текст в одну строку шириной 308 px, кнопки ниже; toast без кнопок — одна строка, как
раньше; длинный текст с одной кнопкой — три строки текста и кнопка под ними.

## Проверить себя

1. Почему обёртка кнопок стоит в документе раньше ×, хотя на экране она ниже него?
   - Ответ: порядок в документе — это порядок Tab: кнопки действий, затем ×, как до правки. Место на экране задаёт
     сетка (`grid-row`), а не порядок.
   - Строки: `src/renderer/toast/ToastRegion.tsx:90-98`
2. Что случится с toast-ом без кнопок?
   - Ответ: обёртки нет, во второй строке сетки ничего нет, и toast остаётся одной строкой: текст и ×.
   - Строки: `src/renderer/toast/ToastRegion.tsx:90-91`
3. Почему у первой колонки `minmax(0, 1fr)`, а не просто `1fr`?
   - Ответ: сейчас это страховка. Длинное слово не распирает колонку и при `1fr`: `overflow: hidden` и
     `overflow-wrap: anywhere` у текста держат её минимум у нуля. Если эти две строки уберут, `1fr` не даст колонке
     стать уже слова, и × уйдёт за край toast-а; нулевой минимум в `minmax(0, 1fr)` держит колонку в ширине toast-а.
   - Строки: `src/renderer/toast/toast.css:32-38`, `src/renderer/toast/toast.css:68-76`

## 6. Что нашёл review и что осталось

> VERIFIED — worfy-polish/126, head 6f083403e (round 2, delta dc7677b7c..6f083403e: the Code story only)
>
> Both round 1 items are fixed. (1) The story (:54-58, :112-114) now calls `minmax(0, 1fr)` a safeguard: the text cell already has `overflow: hidden` and `overflow-wrap: anywhere` (src/renderer/toast/toast.css:74-75); measured — with `1fr` a 200-letter word keeps the column at 308 px. (2) The story (:86-89) now says × stays on row 1 without the `.w-toast__actions` rule (toast.css:105-106).
> The rework's new claims hold: without toast.css:74-75 and with `1fr` the column grows to 1324 px and × leaves the toast, with `minmax(0, 1fr)` it stays at 308 px; without toast.css:80-87 the button row goes to row 2 but only into the first column (308 px), buttons left-aligned, wrapping like inline text.
> `git diff --stat dc7677b7c..6f083403e`: one file, the story; code and tests unchanged. story-check on 6f083403e — exit 0; gate fast — exit 0, `[gate] green (fast)` (cache: no code changed). CI on 6f083403e — ci-ok success.
> Could not verify: the layout in the built Electron app (measured in headless Chromium with the head's CSS); no local e2e by the owner's rule.
> Review depth: low — default: the profile has no review.depth.wave
> Review tokens: 45515

Code: `src/renderer/toast/toast.css:74-75` · key lines: 74

```css
  overflow: hidden;
  overflow-wrap: anywhere;
```
