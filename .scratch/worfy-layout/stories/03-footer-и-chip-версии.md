# Code story — worfy-layout 03: Footer и chip версии

Kind: pr · Epic: worfy-layout · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

Версия приложения, память, строки Harness и Codex со всеми их кнопками стояли колонкой Harness в правом конце header.
Epic worfy-layout делает footer высотой 28 px на всю ширину окна, и колонка в три строки в нём не помещается (Q10).
Поэтому footer показывает компактный chip версии с одной точкой, а всё, что было в колонке, уходит в popover этого
chip-а (Q14). Колонка Harness уходит из header.

- Требование: [Что строить](../issues/03-footer-и-chip-версии.md#что-строить)

## 2. Окно — колонка: ряд sidebar и main area, под ним footer

Code: `src/renderer/shell/AppShell.tsx:174-180` · key lines: 179, 180

```tsx
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
      {/* Across the whole window, outside focus mode's layer: it stays on screen in focus mode, and its version chip keeps working. */}
      <Footer />
```

- Что делает: sidebar и `.w-shell__main` лежат в новом ряду `.w-shell__body`, а `<Footer />` стоит под этим рядом,
  на всю ширину окна. Слой focus mode рисуется внутри `.w-shell__main`, поэтому footer остаётся вне его.
- Почему здесь: Ticket называет `AppShell.tsx` и `.w-shell` в `shell.css` в «Где в коде», а в «Решениях» — ряд
  `.w-shell__body` и footer под ним.
- Без него: footer пришлось бы класть внутрь main area, и в focus mode его закрывал бы слой фокуса, а chip перестал
  бы работать.
- Требование: [Решения](../issues/03-footer-и-chip-версии.md#решения)
- Риски и пробелы test-ов: footer забирает 28 px у Canvas, Session view и sidebar (раздел «Риски» spec-а). e2e
  `focus.spec.ts` и `focus-sidebar.spec.ts` теперь ждут слой фокуса до верха footer-а; локально e2e не запускали.

## 3. Правило точки: худшее первым

Code: `src/renderer/shell/footer/version-dot.ts:26-41` · key lines: 27, 30, 33, 34, 35, 37

```ts
export function versionDot(update: UpdateSnapshot | null, harness: HarnessStatus | undefined, migration: boolean, failure: string | undefined): VersionDot | null {
  if (failure !== undefined) return { tone: 'red', reason: 'Harness unavailable' }
  const harnessBehind = update?.enabled === true ? update.harnessBehind : null
  const part = harness === undefined ? undefined : harnessPart(harness, harnessBehind)
  if (harness !== undefined && part?.button != null && (harness.state.kind === 'not-installed' || harness.state.kind === 'error')) {
    return { tone: 'red', reason: `Harness needs ${part.button.label}` }
  }
  if (migration) return { tone: 'red', reason: 'old Harness to move' }
  if (updateSignal(update)?.dot === true) return { tone: 'amber', reason: updateText(update) ?? 'worfy update' }
  if (part?.button?.accent === true) return { tone: 'amber', reason: `Harness needs ${part.button.label}` }
  const codex = codexPartOf({ status: harness, busy: false, failure })
  if (codex !== null && harness !== undefined && ((codex.button !== undefined && harness.canInstall) || codex.state === 'hooks')) {
    return { tone: 'amber', reason: codex.state === 'hooks' ? codex.text : `Codex needs ${codex.button?.label ?? 'attention'}` }
  }
  return null
}
```

- Что делает: чистая функция даёт одну точку на всё, что предлагает popover. Красная — Harness недоступен, не
  установлен или сломан, пока есть кнопка, или предложен перенос старого Harness. Янтарная — Update приложения с точкой,
  «Update Harness» с акцентом, строка Codex с кнопкой или «Codex: approve hooks». Иначе точки нет. `reason` идёт в
  `aria-label` и в первую строку tooltip-а chip-а.
- Почему здесь: Ticket называет новый файл `version-dot.ts` и записывает правило в «Решениях». Порядок проверок внутри
  цвета не записан: выбран в этом PR.
- Без него: chip не сказал бы, что Harness требует человека, — раньше это была видимая строка «Harness not installed»
  с кнопкой Install в header.
- Требование: [Решения](../issues/03-footer-и-chip-версии.md#решения)
- Риски и пробелы test-ов: `test/unit/version-dot.test.tsx` проверяет каждую строку правила, «Replace Harness» и
  dev-запуск без `canInstall` (15 test-ов). Ticket называл файл `.test.ts`; проект `node` у vitest не импортирует
  `.tsx`, поэтому test лежит в проекте jsdom как `.test.tsx`.

## 4. Chip держит состояние Harness всю жизнь окна

Code: `src/renderer/shell/footer/VersionChip.tsx:37-56` · key lines: 38, 39, 40, 55

```tsx
export function VersionChip() {
  const harness = useHarnessStatus({ opensHooksStep: true })
  const update = useUpdate()
  const memoryShown = useAppSettings((settings) => settings.memoryIndicator)
  const [version, setVersion] = useState<AppVersion>()

  useEffect(() => {
    let active = true
    void invoke('app.version').then((result) => {
      if (!active) return
      if (result.ok) setVersion({ version: result.value.version, number: result.value.number })
      else console.error('app.version failed:', result.error)
    })
    return () => {
      active = false
    }
  }, [])

  return <VersionChipView version={version} update={update} harness={harness} memoryShown={memoryShown} />
}
```

- Что делает: подписки `harness.changed` и `harnessMigration.changed`, кнопка Install и открывающийся сам шаг
  «Approve the Harness hooks in Codex» живут в hook-е `useHarnessStatus`, вынесенном из старого `HarnessStatus.tsx`.
  Hook вызывает chip, а chip смонтирован всегда. Popover только рисует строки.
- Почему здесь: в «Решениях» Ticket-а записано: логика `HarnessStatus` живёт в chip-е, который смонтирован всегда, а не
  в popover-е, иначе шаг перестанет открываться сам (раздел «Риски» spec-а).
- Без него: при закрытом popover-е шаг Codex hooks не открылся бы после install в Codex.
- Требование: [Решения](../issues/03-footer-и-chip-версии.md#решения)
- Риски и пробелы test-ов: `test/unit/codex-hooks-step.test.tsx` проверяет, что шаг открывается из `VersionChip` при
  закрытом popover-е, а chip вместе с Settings → Pipeline дают один шаг. `AppMemory` смонтирован вместе с popover-ом,
  поэтому main меряет память только пока popover открыт: это решение этого PR.

## 5. Узкое окно: только версия, шаг сборки остаётся текстом chip-а

Code: `src/renderer/shell/shell.css:737-758` · key lines: 739, 745, 749, 751

```css
.w-footer__chip-step {
  min-width: 0;
  max-width: 28ch;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* In a window up to 1100 px wide the chip shows the version alone: the step of a build stays in its tooltip.
   The version is drawn from the attribute, so the chip's text stays the step. */
.w-footer__chip-narrow {
  display: none;
}
.w-footer__chip-narrow::before {
  content: attr(data-version);
}
@media (max-width: 1100px) {
  .w-footer__chip-step {
    display: none;
  }
  .w-footer__chip-narrow {
    display: inline;
  }
}
```

- Что делает: шаг сборки Update — не шире 28 символов, с многоточием. При ширине окна 1100 px и меньше шаг прячется, а
  версия рисуется из атрибута `data-version`, поэтому `textContent` chip-а остаётся шагом сборки.
- Почему здесь: Ticket велит при 1100 px и уже показывать только версию; правило 1100 px колонки Harness уходит вместе
  с колонкой. Ширина 28 символов в Ticket-е не записана: выбрана в этом PR.
- Без него: в окне 800×520 шаг сборки сдвигал бы footer, а e2e, которые читают шаги по тексту chip-а, увидели бы версию.
- Требование: [Решения](../issues/03-footer-и-chip-версии.md#решения)
- Риски и пробелы test-ов: jsdom не верстает, поэтому ширину проверяют только e2e `toolbar.spec.ts` и
  `update-toolbar.spec.ts`; локально их не запускали.

## 6. Повтор после ревью: сообщения ведут к chip-у версии

Code: `src/main/harness/migrate/plan.ts:541-542` · key lines: 541, 542

```ts
    if (plugin.kind === 'not-installed') missing.push('the plugin worfy is not installed: install it first from the version chip in the footer')
    else if (plugin.kind === 'outdated') missing.push('the plugin worfy is not the version of this build: update or replace it first from the version chip in the footer')
```

- Что делает: форма переноса старого Harness называет место, где теперь Install и Update Harness, — chip версии в
  footer-е. Так же переписаны три сообщения о слишком старом Harness: Settings → Plan (`PlanSection.tsx`), Code stories
  в Project settings (`ProjectSettings.tsx`) и Eco mode (`eco-mode.ts`) — «Update it from the version chip in the
  footer.».
- Почему здесь: ревью PR #2315 (REJECTED, пункт 1) нашло четыре сообщения, которые отправляли к удалённому пункту
  Harness в toolbar-е. Файлы названы в брифе повторного раунда; в «Где в коде» Ticket-а их нет.
- Без него: человек со старым Harness ищет в toolbar-е пункт, которого больше нет.
- Требование: [Что строить](../issues/03-footer-и-chip-версии.md#что-строить)
- Риски и пробелы test-ов: каждое сообщение закреплено целиком — `test/contract/harness-migrate.test.ts` (оба случая
  плагина), `test/unit/settings-plan.test.tsx`, `test/unit/project-settings-shell.test.tsx` (новый случай `too-old`),
  `test/unit/modes-menu.test.tsx`. Мутант, возвращающий старый текст, валит каждый из них. Комментарии в коде,
  называвшие пункт toolbar-а, и абзац `docs/features/autopilot.md` про «Codex: approve hooks» переписаны тоже; test-а у
  комментариев нет.

## 7. Повтор после ревью: точка молчит, пока идёт install

Code: `src/renderer/shell/footer/VersionChip.tsx:83-84` · key lines: 84

```tsx
  // While its own install runs the Harness line says "Installing Harness…": its dot waits for the answer.
  const dot = versionDot(update, harness.busy ? undefined : harness.status, harness.migration, harness.failure)
```

- Что делает: пока Harness ставится, правило точки получает «состояние неизвестно», и chip не показывает красную
  точку Install для состояния, прочитанного до install.
- Почему здесь: не записано; ревью PR #2315 отметило, что у этого поведения нет test-а.
- Без него: во время install chip горел бы красным «Harness needs Install», хотя Install уже идёт.
- Требование: [Готово, когда](../issues/03-footer-и-chip-версии.md#готово-когда)
- Риски и пробелы test-ов: новый test в `test/unit/update-chip.test.tsx` рисует chip с `busy: true` и Harness «not
  installed» — нет `data-dot` и причины в `aria-label`; с `busy: false` — красная точка. Мутант без `harness.busy`
  валит его.

## 8. Повтор после красного CI: test-ы мерили окно без footer-а

Code: `test/e2e/focus-sidebar.spec.ts:504-507` · key lines: 505, 507

```ts
    const footer = await box(window.getByTestId('footer'))
    expect(footer).toEqual({ x: 0, y: size.height - footer.height, width: size.width, height: footer.height })
    expect(footer.height).toBeGreaterThan(0)
    expect(await box(focus)).toEqual({ x: 0, y: 0, width: size.width, height: footer.y })
```

- Что делает: слой focus mode со скрытым sidebar-ом занимает окно до верхнего края footer-а, а не всё окно; footer
  лежит под ним на всю ширину.
- Почему здесь: CI run на прошлом head-е (`4c5b6db0e`) — пять e2e красные. Четыре из них закрепляли высоту окна до
  footer-а; приложение там делает то, что решено в spec («Footer» — слой focus mode внутри `.w-shell__main`, footer вне
  его). Так же поправлены: `layers-popover.spec.ts` — «под chip-ом очереди и Effort нет места» меряется до верхнего края
  footer-а, а не окна (popover-ы и так стоят над кнопками, `side="top"`); `toolbar.spec.ts` — без колонки Harness
  подпись пути под именем Project-а в окне 1280 px на Windows помещается целиком, поэтому для неё test требует только
  правило обрезки (`text-overflow: ellipsis`, `overflow: hidden`, `nowrap`), а имя Project-а по-прежнему обрезано;
  `product-session.spec.ts` — окно Mind map 1440 × 928: карта получает ту высоту, что была при 900 до footer-а. При
  900 карточка узла не помещалась ни под узлом, ни над ним и закрывала его на несколько пикселей — `cardPlace` так
  делает намеренно, когда карта ниже карточки с обеих сторон.
- Без него: test-ы падают на верном layout-е: слой, popover-ы и карточка стоят там, где решено.
- Требование: [Решения](../issues/03-footer-и-chip-версии.md#решения) — «Риск высоты: footer забирает 28 px у Canvas,
  Session view и sidebar».
- Риски и пробелы test-ов: пятый красный, `done-stack.spec.ts:109` на Windows, прошёл на повторе (Playwright пометил его
  flaky) и footer-а не касается — не правился. Карточка Mind map при окне 1440 × 900 теперь закрывает узел на
  несколько пикселей; это поведение `cardPlace` при низкой карте, не новое, но footer делает такое окно ниже на 28 px.
  E2e локально не запускались (правило владельца): доказательство — CI на новом head-е.

## 9. Что сознательно не меняли

View button-ы в footer-е — Ticket 04: левая часть footer-а пуста. Тексты Guide «on the toolbar» — Ticket 07. Toast-ы
Update не менялись (Q14). ADR не нужен (spec). Кнопки строки Harness остались простым списком, чтобы следующая кнопка
встала в конец. `docs/features/vendors.md` ещё говорит, что шаг Codex hooks показывает toolbar: файл не входит в
повторный раунд и вынесен в отчёт.

## 10. Как проверено

Сначала красный test: `test/unit/version-dot.test.ts` без модуля — exit 1 («Cannot find module»); с модулем — exit 0.
Затем 27 файлов unit и contract test-ов chip-а, Harness, Update, toast, shell, focus mode и Settings — exit 0 (756
test-ов); `pnpm lint && pnpm typecheck && pnpm test` и gate fast — коды выхода в отчёте implementer-а и в
Evidence-строках Ticket-а. Новый e2e `test/e2e/footer.spec.ts` и правки двадцати e2e-файлов локально не запускали
(правило владельца): их проверит CI.

Повторный раунд: шесть мутантов, по одному за раз, каждый валит свой test (exit 1): текст каждого из четырёх
сообщений, возвращённый к toolbar-у (в форме переноса — оба случая плагина), и `harness.busy` убранный из правила
точки. Затем затронутые unit и contract test-ы, `pnpm lint && pnpm typecheck && pnpm test` и gate fast — коды выхода в
отчёте implementer-а и в Evidence-строках Ticket-а.

Повтор после красного CI: правились только четыре e2e-файла; локально их не запускали (правило владельца), проверка —
CI на новом head-е. `pnpm lint && pnpm typecheck && pnpm test` — exit 0, gate fast — код выхода в отчёте
implementer-а.

## Проверить себя

1. Harness не установлен, и пришёл Update приложения. Какого цвета точка и что скажет `aria-label` chip-а?
   - Ответ: красная, «… — Harness needs Install»: Harness, которому нужен человек, проверяется раньше Update.
   - Строки: `src/renderer/shell/footer/version-dot.ts:30-34`
2. Почему шаг Codex hooks открывается сам, хотя popover закрыт?
   - Ответ: состояние Harness с `opensHooksStep` держит chip, который смонтирован всё время жизни окна, а не popover.
   - Строки: `src/renderer/shell/footer/VersionChip.tsx:37-38`
3. Почему в focus mode chip остаётся рабочим?
   - Ответ: слой focus mode рисуется внутри `.w-shell__main`, а footer стоит вне `.w-shell__body`, под ним.
   - Строки: `src/renderer/shell/AppShell.tsx:178-180`
4. Harness не установлен, и человек нажал Install. Почему chip в это время без красной точки?
   - Ответ: пока идёт install (`busy`), правило точки получает вместо статуса `undefined`, а без статуса красной точки Install нет.
   - Строки: `src/renderer/shell/footer/VersionChip.tsx:83-84`
