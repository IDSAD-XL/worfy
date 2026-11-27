# Code story — worfy-polish 167: Кнопка Enable у выключенного Harness-а в строке статуса

Kind: pr · Epic: worfy-polish · Ticket: 167 · PR: - · Language: ru

## 1. Что было не так

Когда plugin worfy установлен, но выключен в Claude Code, строка Harness в popover chip-а версии говорила только
«Harness <версия> · disabled». Кнопки не было: человеку нужно было знать команду `claude plugin enable` или открыть
`/plugin` в Claude Code. Владелец 2026-11-27 (Q5) решил: нужна кнопка Enable.

- Требование: [Что происходит](../issues/167-кнопка-enable-у-выключенного-harness.md#что-происходит)

## 2. Main: enable() запускает `claude plugin enable` и читает статус заново

Code: `src/main/harness/install.ts:581-593` · key lines: 582, 584, 587, 592

```ts
  private async runEnable(): Promise<HarnessEnableResult> {
    await this.running?.catch(() => undefined)
    const before = await this.claudeStatus()
    if (before.state.kind !== 'installed' || before.state.enabled) return { status: await this.withCodex(before), error: null }
    let error: string | null = null
    try {
      await this.claude(['plugin', 'enable', HARNESS_PLUGIN_ID, '--scope', 'user'], 'enable')
    } catch (failure) {
      if (!(failure instanceof StepError)) throw failure
      error = failure.message
    }
    return { status: await this.status(), error }
  }
```

- Что делает: ждёт идущую установку, читает статус; только у «installed, disabled» запускает
  `claude plugin enable worfy@worfy-harness --scope user` бинарём Claude Code этой сборки, затем читает статус снова.
  Ошибка команды — поле `error`, статус при этом прочитан заново и по-прежнему «disabled».
- Почему здесь: Ticket называет main-процесс, где выполняются Install и Update; это тот же `HarnessInstaller` с его
  `claude()` и окружением песочницы. Команда, а не прямая запись в settings.json: ADR-0040 (пункт 7) оставляет
  настройки Claude Code командам `claude plugin`. `--scope user` — потому что статус читает список из папки без
  проектных настроек, то есть область пользователя.
- Без него: кнопке нечего вызвать.
- Требование: [Что строить, п. 2–3](../issues/167-кнопка-enable-у-выключенного-harness.md#что-строить)
- Риски и пробелы test-ов: настоящий `claude plugin enable` не запускали (правило брифа); что он принимает
  `-s, --scope`, видно по строкам справки встроенного бинаря, а не по запуску. Диалога нет: нажатие — согласие;
  ADR-0040 требует подтверждения для установки и обновления, Enable ни то, ни другое.

## 3. Строка: Enable там же, где Install, с accent

Code: `src/renderer/harness/harness-lines.ts:39-46` · key lines: 44, 45

```ts
    case 'installed':
      return {
        text: state.enabled ? `Harness ${state.version}` : `Harness ${state.version} · disabled`,
        title: state.enabled ? undefined : 'The plugin worfy is disabled in Claude Code',
        tone: 'var(--text-muted)',
        // A disabled plugin is a signal, as an update is: the accent, and the chip's amber dot (worfy-polish ticket 167).
        button: state.enabled ? null : offer('enable', 'Enable', `Enable the plugin worfy in Claude Code: ${ENABLE_COMMAND}`, true, 'enable'),
      }
```

- Что делает: у выключенного plugin-а `harnessPart` предлагает кнопку Enable через тот же `offer`, что Install,
  поэтому без `canInstall` кнопки нет. Кнопка с accent: chip версии берёт янтарную точку из того же `harnessPart`.
- Почему здесь: Ticket: «Кнопки нет там, где нет и Install/Update», и «Выключенный plugin даёт chip-у янтарную точку».
- Без него: строка остаётся без действия, точки нет.
- Требование: [Что строить, п. 1 и 4](../issues/167-кнопка-enable-у-выключенного-harness.md#что-строить)
- Риски и пробелы test-ов: янтарная, а не красная точка — выбор по тексту тикета; plugin, выключенный нарочно,
  тоже даёт точку.

## 4. Кнопка и ошибка в tooltip-е

Code: `src/renderer/harness/HarnessStatus.tsx:184-204` · key lines: 186, 187, 192, 201

```tsx
  const { text, tone } = part
  // Enable shows only with its action; its failure goes into both tooltips, and the line keeps "disabled".
  const button = part.button?.action === 'enable' && onEnable === undefined ? null : part.button
  const failed = button?.action === 'enable' && enableFailure !== undefined ? `\n\nEnable failed: ${enableFailure}` : ''
  const title = `${part.title ?? text}${failed}`
  const cleanup = cleanupPart(status.cleanup ?? [])
  return (
    <span role="group" aria-label="Harness" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%' }} data-testid="harness-status" data-state={status.state.kind}>
      <span style={{ ...textStyle, color: tone }} title={title} data-testid="harness-text">
        {text}
      </span>
      {cleanup === null ? null : (
        <span style={{ ...textStyle, color: cleanup.tone }} title={cleanup.title} data-testid="harness-cleanup" data-state={cleanup.state}>
          · {cleanup.text}
        </span>
      )}
      {button === null ? null : button.action === 'enable' ? (
        <IconButton icon={button.icon} label={button.label} title={`${button.title}${failed}`} onClick={() => onEnable?.()} testId="harness-enable" accent={button.accent} />
      ) : (
        <IconButton icon={button.icon} label={button.label} title={button.title} onClick={onInstall} testId="harness-action" accent={button.accent} />
      )}
```

- Что делает: Enable — отдельная кнопка `harness-enable`, она вызывает `onEnable`, а не установку. Текст ошибки
  последнего Enable дописывается в tooltip текста строки и кнопки; сам текст строки остаётся «· disabled».
- Почему здесь: Ticket называет `HarnessLine` в `src/renderer/harness/HarnessStatus.tsx`; её кнопки — простой список.
- Без него: ошибка включения нигде не видна.
- Требование: [Что строить, п. 3](../issues/167-кнопка-enable-у-выключенного-harness.md#что-строить)
- Риски и пробелы test-ов: вид кнопки в окне не снят — GUI-проверки не мои (правило владельца, без Electron).

## 5. Renderer: «Enabling Harness…» и ответ main

Code: `src/renderer/harness/useHarnessStatus.tsx:129-141` · key lines: 131, 133, 137, 138, 139

```tsx
  const onEnable = (): void => {
    setBusy(true)
    setBusyText('Enabling Harness…')
    setEnableFailure(undefined)
    void invoke('harness.enable').then((result) => {
      setBusy(false)
      if (result.ok) {
        setFailure(undefined)
        setStatus(result.value.status)
        setEnableFailure(result.value.error ?? undefined)
      } else setEnableFailure(result.error)
    })
  }
```

- Что делает: пока main отвечает, строка говорит «Enabling Harness…» (и chip без точки, как при своей установке);
  затем показывает статус из ответа. Ошибка команды и ошибка самого вызова идут в tooltip, а не в «Harness unavailable».
- Почему здесь: состояние строки живёт в `useHarnessStatus`, который держат chip версии и Settings → Pipeline.
- Без него: после нажатия строка не перечитывается.
- Требование: [Готово, когда, п. 1](../issues/167-кнопка-enable-у-выключенного-harness.md#готово-когда)
- Риски и пробелы test-ов: `enableFailure` сбрасывается следующим `harness.changed` или действием.

## 6. Все окна узнают об удачном Enable

Code: `src/main/ipc/harness.ts:89-105` · key lines: 98, 99

```ts
  /**
   * An enable that went in (no `error`) reaches every window too, once per run (worfy-polish ticket 167);
   * a failed one changed nothing, and one that throws reaches its caller only.
   */
  override enable(): Promise<HarnessEnableResult> {
    const run = super.enable()
    if (!this.announced.has(run)) {
      this.announced.add(run)
      run.then(
        (result) => {
          if (result.error === null) toEveryWindow((client) => emit(client, harnessChanged, result.status))
        },
        () => undefined,
      )
    }
    return run
  }
```

- Что делает: удачный Enable (без `error`) уходит всем окнам как `harness.changed`, один раз на запуск; неудачный ничего
  не менял и не рассылается.
- Почему здесь: так же рассылается каждая установка (worfy-harness ticket 40), и в этом же классе.
- Без него: второе окно и Settings → Pipeline показывают «disabled» до перезагрузки.
- Требование: не записано
- Риски и пробелы test-ов: `test/contract/harness-changed.test.ts` проверяет рассылку на фейковом установщике.

## 7. Test: неудачный `plugin enable`

Code: `test/contract/harness-install.test.ts:1385-1393` · key lines: 1387, 1389, 1390

```ts
  it('a failing `plugin enable` answers its error with the tail of stderr, and the state read again still says disabled', async () => {
    const subject = await installedThenDisabled()
    sb.env.STUB_CLAUDE_FAIL = 'plugin enable'
    const result = await subject.enable()
    expect(result.status.state).toEqual({ kind: 'installed', version: V1, enabled: false })
    expect(result.error).toContain(`claude ${ENABLE_WORFY} exited with 3`)
    expect(result.error).toContain('failed: stub error')
    expect(commands()).toEqual([LIST, ENABLE_WORFY, LIST])
  })
```

- Что делает: stub Claude Code в песочнице (`HOME` и `CLAUDE_CONFIG_DIR` во временной папке) падает на
  `plugin enable`; ответ несёт его хвост stderr, а статус по-прежнему «disabled». Соседние test-ы: удачный Enable
  без записи файлов worfy, отказ dev-запуска, ожидание установки, один запуск на два нажатия.
- Почему здесь: Ticket называет unit- и contract-test-ы на действие Enable.
- Без него: ошибка могла бы показаться как «enabled» или потеряться.
- Требование: [Готово, когда, п. 2](../issues/167-кнопка-enable-у-выключенного-harness.md#готово-когда)
- Риски и пробелы test-ов: stub, не настоящий Claude Code.

## 8. Что сознательно не меняли

Первый запуск (`src/main/first-run/checks.ts`) по-прежнему советует команду `claude plugin enable` текстом, без
кнопки; `src/main/projects/connect.ts` отсылает к первому запуску. Popover после Enable не закрывается, как и после
Install. Перевод `docs/features/ru/` не правился (ADR-0088).

## 9. Как проверено

До правки 17 новых test-ов красные (`pnpm test` четырёх файлов — exit 1), после — exit 0. `pnpm lint`,
`pnpm typecheck`, `pnpm test` — exit 0; gate fast — exit 0. e2e и Electron локально не запускали (правило владельца).

## Проверить себя

1. Почему у Enable нет диалога согласия, а у Install есть?
   - Ответ: Enable ничего не устанавливает и не копирует: он только включает уже установленный plugin командой
     Claude Code; нажатие на кнопку и есть согласие.
   - Строки: `src/main/harness/install.ts:587`
2. Почему неудачный Enable не рассылается окнам?
   - Ответ: он ничего не изменил, а событие, пришедшее после ответа, стёрло бы ошибку из tooltip-а.
   - Строки: `src/main/ipc/harness.ts:98-99`
3. Откуда у chip-а янтарная точка при выключенном plugin-е?
   - Ответ: `harnessPart` даёт кнопке Enable accent, а точка chip-а читает тот же `harnessPart`.
   - Строки: `src/renderer/harness/harness-lines.ts:45`

## 10. Что нашёл review и что осталось

> VERIFIED — worfy-polish 167 (an Enable button in the Harness line of the version chip's popover when the Claude Code plugin is installed but disabled: main runs `claude plugin enable worfy@worfy-harness --scope user` through the same sandboxed runner as Install, refuses in a dev run, broadcasts harness.changed only on success; the chip gets an amber dot "Harness needs Enable"), head 69a492c7fe8ac481698a143f8350dcdff625f32e
>
> Gate (depth medium, one round): worfy:reviewer, lens correctness — all four done items covered by code and tests; 4 of 4 mutants red (enabled check in install.ts, unconditional broadcast, dropped setEnableFailure, Enable accent false). pnpm test on the four touched files 167/167 EXIT=0, lint EXIT=0, typecheck EXIT=0, story-check EXIT=0; implementer: full pnpm test 21597 EXIT=0, gate fast green.
> Consider: none
> Noted: [low] src/main/harness/install.ts:556 — install() does not wait for a running this.enabling (enable() waits for this.running at :582): Install from another window or the first-run screen during Enable could run plugin install/update next to plugin enable; one state never shows both buttons, so rare.
> Dismissed: none
> Not verified: the real `claude plugin enable` (stub in tests; manual item 4 in Stable).
> Review depth: medium — owner rule
> Review tokens: 77237

Code: `src/main/harness/install.ts:556-556` · key lines: 556

```ts
    this.running ??= this.runInstall(confirm).finally(() => {
```
