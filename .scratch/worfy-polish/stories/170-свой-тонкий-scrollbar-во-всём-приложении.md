# Code story — worfy-polish 170: Свой тонкий scrollbar во всём приложении, один и тот же на macOS и Windows

Kind: pr · Epic: worfy-polish · Ticket: 170 · PR: - · Language: ru

## 1. Что было не так

Своего scrollbar-а в renderer не было: каждый прокручиваемый контейнер (transcript Session, body Assistant-а,
Settings, Pull requests, diff в Changes и ещё около 70) рисовал native scrollbar Chromium-а. На Mac с мышью или при
Show scroll bars = «Always» и всегда на Windows это classic scrollbar шириной 15–17 px с серой дорожкой; на Mac с
trackpad-ом — тонкий overlay. Владелец просит один свой вид везде.

- Требование: [Что происходит](../issues/170-свой-тонкий-scrollbar-во-всём-приложении.md#что-происходит)

## 2. Thumb виден только при наведении и во время прокрутки

Code: `src/renderer/theme/scrollbars.css:29-44` · key lines: 30, 32, 36, 37, 41

```css
*::-webkit-scrollbar-thumb {
  border: 1.5px solid transparent;
  border-radius: 999px;
  background-color: transparent;
  background-clip: padding-box;
}

*:hover::-webkit-scrollbar-thumb,
[data-scrolling]::-webkit-scrollbar-thumb {
  background-color: var(--scrollbar-thumb);
}

*::-webkit-scrollbar-thumb:hover,
*::-webkit-scrollbar-thumb:active {
  background-color: var(--scrollbar-thumb-hover);
}
```

- Что делает: правила стоят на `*`, поэтому их получает каждый контейнер без своего класса. Выше в файле —
  ширина и высота 8 px, прозрачные дорожка и угол, нет кнопок. Thumb скруглён, прозрачная рамка 1,5 px оставляет
  видимую полосу около 5 px. В покое он прозрачен; виден, пока курсор над контейнером или у контейнера есть
  `data-scrolling`; под курсором и при перетаскивании — цвет hover.
- Почему здесь: Ticket называет файл `src/renderer/theme/scrollbars.css` и импорт рядом с `tokens.css`
  (`main.tsx:5`). Почему виден только при наведении и прокрутке: Ticket — «так Windows и Mac с мышью выглядят как
  overlay scrollbar на Mac с trackpad-ом».
- Без него: native classic scrollbar с дорожкой на Windows и на Mac с мышью.
- Требование: [Что строить, п. 1](../issues/170-свой-тонкий-scrollbar-во-всём-приложении.md#что-строить)
- Риски и пробелы test-ов: вид pseudo-element-а jsdom не рисует; перерисовку thumb-а по `:hover` и по смене
  атрибута в Electron я не видел (Electron локально запрещён брифом) — это ручной пункт на Mac Stable. Rail sidebar
  (`.w-sidebar__rail::-webkit-scrollbar { width: 0 }`) специфичнее `*` и остаётся скрытым.

## 3. Один hook на окно метит контейнер, который прокручивается

Code: `src/renderer/theme/scrolling-mark.ts:18-33` · key lines: 20, 23, 24, 27, 33

```ts
    const onScroll = (event: Event): void => {
      // The document's own scroll comes from the document: its scrollbar is the root element's.
      const element = event.target instanceof Element ? event.target : event.target === document ? document.documentElement : null
      if (element === null) return
      const running = timers.get(element)
      if (running !== undefined) clearTimeout(running)
      else element.setAttribute(ATTRIBUTE, '')
      timers.set(
        element,
        setTimeout(() => {
          timers.delete(element)
          element.removeAttribute(ATTRIBUTE)
        }, SCROLLING_MARK_MS),
      )
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
```

- Что делает: `scroll` элемента не всплывает, но слушатель на `document` в фазе capture его слышит. Прокрученному
  элементу ставится `data-scrolling`; каждое новое событие переносит снятие метки на 800 ms
  (`SCROLLING_MARK_MS`) после последнего. На unmount снимаются слушатель, таймеры и метки. `App` в `main.tsx:74`
  вызывает hook один раз; компоненты его не зовут.
- Почему здесь: Ticket — «одним CSS „пока прокручивается“ не показать: прокрутка колесом или клавишами без курсора
  над контейнером `:hover` не даёт»; там же место (`src/renderer/theme/`), имя, capture и ~800 ms.
- Без него: при прокрутке клавишами или колесом с курсором вне контейнера thumb не появлялся бы.
- Требование: [Что строить, п. 1](../issues/170-свой-тонкий-scrollbar-во-всём-приложении.md#что-строить)
- Риски и пробелы test-ов: `test/unit/scrolling-mark.test.tsx` проверяет метку, её продление, снятие через паузу,
  что метится только прокрученный элемент и что после unmount слушателя и таймеров нет. Map таймеров держит
  элемент до 800 ms после последнего события, даже если его уже убрали из DOM.

## 4. Цвета из tokens, тех же у Terminal

Code: `src/renderer/canvas/nodes/TerminalNode.tsx:113-116` · key lines: 114, 115, 116

```tsx
    // xterm draws its own scrollbar; its thumb takes the colours of the app's (theme/scrollbars.css).
    scrollbarSliderBackground: token('--scrollbar-thumb'),
    scrollbarSliderHoverBackground: token('--scrollbar-thumb-hover'),
    scrollbarSliderActiveBackground: token('--scrollbar-thumb-hover'),
```

- Что делает: xterm 6 рисует свой scrollbar; его thumb теперь берёт цвета из новых tokens `--scrollbar-thumb` и
  `--scrollbar-thumb-hover` (`tokens.css:72-73` light, `:206-207` dark). Их значения — в таблице Tokens F-SPEC и в
  `test/e2e/theme.spec.ts`.
- Почему здесь: Ticket называет `themeOf` (`TerminalNode.tsx:101-112`) и три поля `scrollbarSlider*`. Почему hover и
  active одного цвета: not recorded.
- Без него: у Terminal остался бы серый thumb xterm-а по умолчанию, не связанный с темой.
- Требование: [Что строить, п. 2 и 5](../issues/170-свой-тонкий-scrollbar-во-всём-приложении.md#что-строить)
- Риски и пробелы test-ов: `test/unit/contrast.test.ts` проверяет, что thumb виден на каждом фоне приложения
  (≥ 1,5:1) и что hover контрастнее покоя; против фона Terminal отдельной проверки нет. e2e `theme.spec.ts` локально
  не запускался — его гоняет CI.

## 5. Test: ничто не выключает общий стиль

Code: `test/unit/scrollbars-css.test.ts:56-59` · key lines: 57, 58

```ts
  it('meets scrollbar-width only where a scrollbar is hidden on purpose', () => {
    const widths = linesMatching(/scrollbar-width|scrollbarWidth/)
    expect(widths.filter((line) => !/(scrollbar-width:\s*none;|scrollbarWidth:\s*'none')/.test(line))).toEqual([])
  })
```

- Что делает: обходит все `.css`, `.ts` и `.tsx` под `src/renderer/` без комментариев; `scrollbar-width` допустим
  только со значением `none`. Рядом — `scrollbar-color` не встречается нигде, `main.tsx` импортирует
  `scrollbars.css` сразу после `tokens.css`, а сам файл стиля опирается на tokens и `data-scrolling`.
- Почему здесь: Ticket — Chromium не применяет `::-webkit-scrollbar` к элементу с `scrollbar-width` или
  `scrollbar-color`, а `scrollbar-color` ещё и наследуется. Поэтому же убран `scrollbar-width: thin` у toolbar Mind
  map (`mind-map.css`).
- Без него: новая панель с `scrollbar-width: thin` незаметно вернула бы у себя native scrollbar.
- Требование: [Test-ы](../issues/170-свой-тонкий-scrollbar-во-всём-приложении.md#test-ы)
- Риски и пробелы test-ов: до правки три проверки красные (нет файла стиля и импорта; `mind-map.css:55`), exit 1.
  Комментарии test пропускает, чтобы сам `scrollbars.css` мог назвать эти свойства.

## 6. Что сознательно не меняли

`scrollbar-width: none` у presets Focus mode и chapters Story и `width: 0` у rail sidebar — scrollbar там спрятан
намеренно. Padding узких контейнеров (body Assistant-а, menu, popover, select, Command palette) не трогал: Ticket
велит править «только там, где видно на глаз», а окно приложения я не открывал. ScrollArea из `@base-ui/react`
(настоящий overlay) — не в этом Ticket-е.

## 7. Как проверено

До правки `node scripts/vitest-electron.mjs test/unit/scrollbars-css.test.ts test/unit/scrolling-mark.test.tsx` —
exit 1; после, вместе с `test/unit/contrast.test.ts`, — exit 0. `pnpm lint` и `pnpm typecheck` — exit 0. Первый
`pnpm test` — exit 1: один timeout под нагрузкой машины в `test/unit/pr-inbox-view.test.tsx` (первый test файла,
15 s; PR inbox этот PR не трогает). Gate fast следом прогнал lint, typecheck и весь `pnpm test` — exit 0,
`[gate] green (fast)`. e2e и Electron локально не запускали.
Первый CI: job `windows (1/3) / full-suite` красный — test импорта ждал `\n`, а checkout на Windows даёт CRLF;
test теперь приводит концы строк к LF (`read` в `test/unit/scrollbars-css.test.ts`).

## Проверить себя

1. Почему для «пока прокручивается» понадобился hook, а не только CSS?
   - Ответ: `:hover` есть лишь под курсором; прокрутка клавишами или колесом с курсором вне контейнера его не даёт,
     поэтому нужна метка `data-scrolling`, которую ставит слушатель `scroll`.
   - Строки: `src/renderer/theme/scrollbars.css:37`, `src/renderer/theme/scrolling-mark.ts:33`
2. Почему слушатель стоит в фазе capture?
   - Ответ: событие `scroll` элемента не всплывает до `document`; в фазе capture `document` его слышит.
   - Строки: `src/renderer/theme/scrolling-mark.ts:33`
3. Чем опасен `scrollbar-width: thin` в новой панели?
   - Ответ: Chromium тогда не применяет `::-webkit-scrollbar` к этому элементу, и там снова native scrollbar;
     test ловит такую строку.
   - Строки: `test/unit/scrollbars-css.test.ts:58`

## 8. Что нашёл review и что осталось

> VERIFIED
>
> Блокирующих дефектов в PR #2360 (свой тонкий scrollbar на всём renderer, worfy-polish 170) нет, ниже два `[low]`.
>
> - `src/renderer/canvas/nodes/TerminalNode.tsx:115-116` [low] — в светлой теме фон Terminal тёмный (`--terminal-bg: #1d1d1f`, `src/renderer/theme/tokens.css:95`). Hover-цвет `#8e8e93` темнее цвета покоя. Под курсором контраст thumb-а Terminal падает с 8,5:1 до 5,2:1, то есть thumb блекнет, а должен выделяться. `test/unit/contrast.test.ts:102` проверяет только фоны приложения, `--terminal-bg` в список не входит. Исправление: для светлой темы Terminal брать более светлый hover-цвет или полупрозрачные цвета от `--terminal-text`.
> - `test/unit/scrollbars-css.test.ts:44-50` [low] — test не проверяет правило `*:hover::-webkit-scrollbar-thumb` и прозрачность thumb-а в покое (`src/renderer/theme/scrollbars.css:30-40`). Если удалить hover-правило (thumb перестанет появляться при наведении) или сделать thumb видимым в покое, test останется зелёным.
>
> Вопросы из брифа (ни один дефектом не оказался):
> - Слушатель scroll на `document` в фазе capture один на окно. На одно событие — `Map.get` и пара `clearTimeout`/`setTimeout`. Метка на отсоединённом от DOM элементе живёт до 800 ms, потом таймер снимает её вместе с записью в Map.
> - Ни один MutationObserver renderer-а не слушает атрибут `data-scrolling`: в `src/renderer/focus/cover.ts:74`, `src/renderer/getting-started/GettingStartedPanel.tsx:319` и `src/renderer/theme/kit/layer.ts:104` стоит `attributeFilter`.
> - Намеренно скрытые scrollbar-ы остаются скрытыми. Правило `src/renderer/shell/shell.css:100` специфичнее общего, `scrollbar-width: none` в focus и stories и класс base-ui `scrollbar-width:none` выключают стиль, как и задумано.
> - В CSS React Flow и xterm нет ни `scrollbar-color`, ни `scrollbar-width`.
> - У `.xterm-viewport` в xterm 6.0.0 нет прокручиваемого содержимого, свой scrollbar xterm рисует divs. Второго thumb-а в Terminal не будет.
> - Monaco в зависимостях нет.
> - На Windows thumb в покое не виден, подсказку о прокрутке даёт только hover. Это решение из тикета (вид как у overlay scrollbar на Mac), поэтому не дефект.
>
> Пункты «Готово, когда»:
> 1. Выполнен: `src/renderer/theme/scrollbars.css`, импорт в `src/renderer/main.tsx:5`, tokens в `tokens.css:72-73` и `:206-207`, строка в таблице `docs/design/F-SPEC.md:29`.
> 2. По коду выполнен: `scrollbars.css:30-44`, hook `src/renderer/theme/scrolling-mark.ts:15-42`, вызов в `main.tsx:74`. Как это рисуется в Electron, я не видел.
> 3. Выполнен: оба новых test-а есть, новые tokens в `test/e2e/theme.spec.ts:21-22` и `:57-58`. Что test-ы были красными до правки, я сам не перепроверял.
> 4. Выполнен: `TerminalNode.tsx:114-116`.
> 5. Выполнен: в «Итог» записано мнение об overlay — отдельный Ticket сейчас не нужен.
> 6. `ci-ok` — pass на head d65ea3b5f (`gh pr checks 2360`, exit 0).
>
> Что запускал:
> - `pnpm install --frozen-lockfile` — exit 0.
> - Три test-файла по команде из брифа с `run` — exit 0, но прошло 18 файлов: скрипт-обёртка vitest передаёт `run` как фильтр имён файлов. Без `run` — 3 файла, 140 test-ов, exit 0.
> - Мутанты `scrolling-mark.ts` — все три пойманы (exit 1):
>   - таймер не сбрасывается при новой прокрутке;
>   - слушатель в фазе bubble вместо capture;
>   - cleanup при unmount не снимает метки.
> - Файл восстановлен из копии, `cmp` — exit 0.
>
> Что не проверил:
> - Перерисовывает ли Chromium thumb, когда меняется только `:hover` или `data-scrolling`, и прячет ли его после снятия метки без нового движения курсора. Это ручной пункт 7, Electron по брифу запрещён.
> - Вид на Windows.
> - Полные `pnpm lint`, `pnpm typecheck`, `pnpm test` локально — сужу по зелёному `ci-ok`.
> - Gate не запускал.
>
> [line 40 of the verdict is not quoted: personal data (home-path)]
>
> Orchestrator: both lows are not blockers (the Terminal thumb on hover still has 5.2:1 contrast); landing as is.
>
> Review depth: medium — ticket

Code: `src/renderer/canvas/nodes/TerminalNode.tsx:115-116` · key lines: 115

```tsx
    scrollbarSliderHoverBackground: token('--scrollbar-thumb-hover'),
    scrollbarSliderActiveBackground: token('--scrollbar-thumb-hover'),
```

Code: `src/renderer/theme/tokens.css:95-95` · key lines: 95

```css
  --terminal-bg: #1d1d1f;
```

Code: `test/unit/contrast.test.ts:102-102` · key lines: 102

```ts
    it.each(grounds)('the scrollbar thumb shows on %s and darkens or lightens under the pointer', (ground) => {
```

Code: `test/unit/scrollbars-css.test.ts:44-50` · key lines: 44

```ts
  it('styles every element and takes its colours from the tokens', () => {
    const css = read(join(RENDERER, 'theme/scrollbars.css'))
    expect(css).toContain('*::-webkit-scrollbar {')
    expect(css).toContain('var(--scrollbar-thumb)')
    expect(css).toContain('var(--scrollbar-thumb-hover)')
    expect(css).toContain('[data-scrolling]::-webkit-scrollbar-thumb')
  })
```

Code: `src/renderer/theme/scrollbars.css:30-40` · key lines: 30

```css
  border: 1.5px solid transparent;
  border-radius: 999px;
  background-color: transparent;
  background-clip: padding-box;
}

*:hover::-webkit-scrollbar-thumb,
[data-scrolling]::-webkit-scrollbar-thumb {
  background-color: var(--scrollbar-thumb);
}

```
