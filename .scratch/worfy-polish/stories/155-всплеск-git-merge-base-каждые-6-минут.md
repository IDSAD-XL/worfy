# Code story — worfy-polish 155: Всплеск `git merge-base --is-ancestor` каждые 6 минут: общий кэш пар, один вопрос на пару, предел процессов git

Kind: pr · Epic: worfy-polish · Ticket: 155 · PR: - · Language: ru

## 1. Что было не так

Владелец на Windows видел раз в 6 минут 40–80 процессов `git.exe` из main process за одну секунду — и подвисание
всего рабочего стола (issue #2252). Источник — строка Stable copy пункта Acceptance: `AcceptanceService` пересчитывает
очередь раз в 60 s, а ответ, который может измениться, StableLine хранит `RETRY_MS` = 5 минут, поэтому его спрашивают на
первом tick-е после истечения — через 6 минут. Ответы 0/1 хранились только внутри своего worktree, ответ 128 (commit-а
нет в checkout-е) не хранился вовсе, и все вопросы одного пересчёта уходили сразу. В test-е с тремя worktree и 20
merge-ами это 269 процессов в первом цикле (до 249 одновременно) и 43 в каждом следующем.

- Требование: [Что происходит](../issues/155-всплеск-git-merge-base-каждые-6-минут.md#что-происходит)

## 2. Один ответ на пару и один вопрос в пути

Code: `src/main/workflow/git-ancestry.ts:59-79` · key lines: 62, 66, 68, 74

```ts
  async isAncestor(repo: string, ancestor: string, descendant: string): Promise<number | null> {
    const key = pairKey(repo, ancestor, descendant)
    const known = this.answers.get(key)
    if (known !== undefined) return known
    const flight = this.flights.get(key)
    if (flight !== undefined) {
      const code = await flight.code
      if (flight.repo === repo || code === 0 || code === 1) return code
      // The checkout in flight did not have a commit: this one may.
      return this.isAncestor(repo, ancestor, descendant)
    }
    const code = this.ask(repo, ancestor, descendant)
    this.flights.set(key, { repo, code })
    try {
      const answer = await code
      if ((answer === 0 || answer === 1) && keepable(ancestor, descendant)) this.answers.set(key, answer)
      return answer
    } finally {
      this.flights.delete(key)
    }
  }
```

- Что делает: известный ответ отдаёт без процесса. Вопрос той же пары, пока первый в пути, ждёт его ответа; если
  первый задан в другом checkout-е и получил не 0/1, спрашивает в своём. Хранит только 0 и 1, и только для двух SHA.
- Почему здесь: Ticket называет новый модуль в «Где в коде» и требует хранить только exit 0 и 1; почему exit 128 не
  хранится — commit может появиться после `git pull` владельца (раздел «Решено без владельца»).
- Без него: каждый worktree и каждый модуль main спрашивают одну и ту же пару заново, а два одновременных вопроса
  запускают два процесса.
- Требование: [Что делаем, п. 1](../issues/155-всплеск-git-merge-base-каждые-6-минут.md#что-делаем)
- Риски и пробелы test-ов: рекурсия после ответа 128 из другого checkout-а ждёт следующий полёт той же пары; test
  «asks in its own checkout when the one in flight elsewhere did not have the commit» проверяет один такой шаг.

## 3. Ключ ответа: пара полных SHA, иначе с репозиторием; ref — никогда

Code: `src/main/workflow/git-ancestry.ts:86-95` · key lines: 88, 94

```ts
/** The key an answer is kept by: the pair for two full SHAs, the pair in its repository otherwise. */
function pairKey(repo: string, ancestor: string, descendant: string): string {
  if (FULL_SHA.test(ancestor) && FULL_SHA.test(descendant)) return `${ancestor} ${descendant}`
  return `${repo}\n${ancestor} ${descendant}`
}

/** Whether an answer for the pair may be kept: two SHAs, not a ref. */
function keepable(ancestor: string, descendant: string): boolean {
  return SHORT_SHA.test(ancestor) && SHORT_SHA.test(descendant)
}
```

- Что делает: две полные SHA — ключ без пути, ответ общий для всех worktree (`F:\SWE\worfy` и `F:\SWE\worfy-w16`).
  Короткий SHA — с путём: в другом репозитории он может значить другой commit. `refs/heads/main` (Flight Recorder)
  не хранится: ref двигается.
- Почему здесь: бриф требует ключ (ancestor, descendant); отделить короткие SHA и ref-ы — решение этого Ticket-а,
  записано в комментарии модуля.
- Без него: с ключом по пути второй worktree спрашивает всё заново; с ключом без пути для ref-а Flight Recorder видел
  бы устаревший ответ про `main`.
- Требование: [Что делаем, п. 1](../issues/155-всплеск-git-merge-base-каждые-6-минут.md#что-делаем)
- Риски и пробелы test-ов: репозитории на SHA-256 (64 знака) приняты регулярным выражением, но test-а на них нет.

## 4. Общая очередь не больше трёх процессов

Code: `src/main/workflow/git-ancestry.ts:25-41` · key lines: 30, 32, 36, 37, 38

```ts
/** A runner that starts at most `limit` calls of `git` at once; the others wait in order. */
function limited(git: GitRunner, limit: number): GitRunner {
  let running = 0
  const waiting: (() => void)[] = []
  return async (cwd, args) => {
    if (running < limit) running += 1
    // The place is handed over by the call that ends, so `running` stays as it is.
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await git(cwd, args)
    } finally {
      const next = waiting.shift()
      if (next !== undefined) next()
      else running -= 1
    }
  }
}
```

- Что делает: семафор: свободное место — сразу, иначе в очередь; закончивший вызов передаёт место следующему, в том
  числе когда runner бросил исключение.
- Почему здесь: в `src/main` нет общего ограничителя — `inPool` из `src/main/workflow/reader.ts` живёт внутри одного
  вызова (раздел «Решено без владельца»); предел 3 — из диапазона 2–4 репорта.
- Без него: первый проход после старта запускает все вопросы разом — 249 процессов в test-е.
- Требование: [Что делаем, п. 1](../issues/155-всплеск-git-merge-base-каждые-6-минут.md#что-делаем)
- Риски и пробелы test-ов: git, который висит до `timeout` 10 s у `gitRunner`, держит место всё это время; три таких
  вызова задерживают остальные пути на 10 s. Test-а на это нет.

## 5. Один экземпляр на runner

Code: `src/main/workflow/git-ancestry.ts:97-107` · key lines: 101, 103

```ts
const shared = new WeakMap<GitRunner, GitAncestry>()

/** The one GitAncestry of a git runner: the app's gitRunner shares its answers and its limit across main. */
export function ancestryFor(runner: GitRunner): GitAncestry {
  let ancestry = shared.get(runner)
  if (ancestry === undefined) {
    ancestry = new GitAncestry(runner)
    shared.set(runner, ancestry)
  }
  return ancestry
}
```

- Что делает: у `gitRunner` приложения — один экземпляр на процесс: StableLine, StageReader каждого Project-а и
  `readLocalVerdicts` делят ответы и очередь. Fake runner test-а получает свой.
- Почему здесь: not recorded
- Без него: каждый StageReader (по одному на Project) и каждый вызов `readLocalVerdicts` держали бы свой кэш и свой
  предел, и процессов одновременно было бы больше трёх.
- Требование: [Что делаем, п. 2](../issues/155-всплеск-git-merge-base-каждые-6-минут.md#что-делаем)
- Риски и пробелы test-ов: код, который обернёт `gitRunner` своей функцией, получит отдельный экземпляр; сейчас
  такого нет (Flight Recorder передаёт `gitRunner` как есть).

## 6. Checkout без коммита Stable copy: одна проверка вместо вопроса на каждый merge

Code: `src/main/acceptance/stable-line.ts:198-205` · key lines: 201, 203

```ts
    if (pending) return null
    if (shas.length === 0) return notChecked('no merged PR found')
    // A checkout without the Stable copy's commit can answer nothing about it: one look, not a question per merge.
    const present = this.presence.get(`${root}\n${stable}`, () => this.askPresence(root, stable))
    if (present === undefined) return null
    if (present === 'no') return notChecked(`its commit ${short(stable)} is not in this checkout`)
    if (present === 'failed') return notChecked('git did not answer')
    const facts = shas.map((sha) => ({
```

- Что делает: до вопросов по merge-ам и до команд сборки один раз смотрит `cat-file -e <stable>^{commit}`; «есть»
  хранится навсегда, «нет» — `RETRY_MS`. Нет коммита — строка «not in this checkout» без единого `merge-base`.
- Почему здесь: в репорте (`worfy-demo`) по commit-у Stable copy каждый цикл шли `merge-base`, `rev-list --count`,
  `show :package.json` — ответа на них нет, пока commit-а нет; Ticket описывает это в «Что происходит», п. 3 «Что
  делаем».
- Без него: такой checkout в каждом цикле стоит 2 процесса на merge и 3 на сборку — 43 в test-е.
- Требование: [Что делаем, п. 3](../issues/155-всплеск-git-merge-base-каждые-6-минут.md#что-делаем)
- Риски и пробелы test-ов: проверка стоит после вопросов к GitHub, поэтому вопросы `gh` о merge-ах в таком checkout-е
  остаются (они хранятся навсегда после merge).

## 7. Stage Deploy спрашивает через тот же модуль

Code: `src/main/workflow/stages.ts:374-377` · key lines: 376

```ts
  private async isAncestor(repo: string, ancestor: string, descendant: string): Promise<boolean> {
    if (ancestor === descendant) return true
    return (await this.ancestry.isAncestor(repo, ancestor, descendant)) === 0
  }
```

- Что делает: свой `Map` StageReader-а (по одному на Project) заменён общим модулем; смысл прежний: 0 — да, всё
  остальное — пока нет.
- Почему здесь: Ticket называет `stages.ts:361-380` в «Где в коде»; комментарий там говорил «kept for good», но только
  для одного Project-а.
- Без него: два Project-а над worktree одного репозитория спрашивают одну пару дважды.
- Требование: [Что делаем, п. 2](../issues/155-всплеск-git-merge-base-каждые-6-минут.md#что-делаем)
- Риски и пробелы test-ов: у Project-ов worfy Stage Deploy нет; test — contract test двух StageReader-ов над одним
  fake runner-ом.

## 8. Что сознательно не меняли

Цикл по commit-ам не заменён одним git-вызовом на worktree: вопросы StableLine идут по одному ключу через `Kept`,
пакет туда чисто не ложится, а `for-each-ref --contains` работает только с ref-ами. Команды сборки
(`rev-parse --is-shallow-repository`, `rev-list --count`, `show`) по-прежнему хранятся в своём worktree. Exit 128 и code
null не хранятся. `src/main/update/` не тронут — пересборку из части 2 репорта чинит worfy-polish 156.

## 9. Как проверено

Test-ы написаны до правки и были красными: `acceptance-stable-line` (второй цикл — 43 процесса вместо 1, пик 249
вместо 3), `workflow-stages` (2 вопроса вместо 1), `flight-recorder-gate-logs` (4 вместо 2); новый
`test/unit/git-ancestry.test.ts` — 10 test-ов. Шесть mutant-ов модуля и StableLine (хранить 128, без предела, без
общего вопроса в пути, ключ всегда с путём, хранить ref, без проверки коммита Stable copy) — все красные. Test-ы
затронутых модулей (58 файлов) — exit 0; `pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — exit 0, green.

## Проверить себя

1. Почему ответ 128 не хранится, хотя именно он повторялся каждые 6 минут?
   - Ответ: 128 значит, что commit-а нет в этом checkout-е; после `git pull` он появится, и ответ станет 0 или 1.
     Повтор оставлен, но идёт через очередь, а для коммита Stable copy — одной проверкой на worktree.
   - Строки: `src/main/workflow/git-ancestry.ts:74-74`, `src/main/acceptance/stable-line.ts:201-203`
2. Почему ключ без пути только для полных SHA?
   - Ответ: полный SHA называет один и тот же commit в любом репозитории, а короткий в другом репозитории может
     указать на другой; ref двигается и не хранится вовсе.
   - Строки: `src/main/workflow/git-ancestry.ts:88-94`
3. Что происходит, если тот же вопрос пришёл из другого worktree, пока первый в пути, и первый получил 128?
   - Ответ: второй ждёт ответа первого, видит, что это не 0/1 и задан в чужом checkout-е, и спрашивает в своём.
   - Строки: `src/main/workflow/git-ancestry.ts:63-68`
