#!/usr/bin/env node
// PreToolUse: запрещает команды, которые уничтожают незакоммиченную работу, и
// трубы, глотающие код возврата проверок.
//
// Решение отдаётся полем permissionDecision. Выходим всегда с нулём: ошибка в
// самом хуке не должна ни ломать сессию, ни молча пропускать вызов незамеченным.
//
// Разбор идёт по звеньям команды и по её аргументам, а не по совпадению строки:
// `git -C /p checkout HEAD -- .` и `git checkout -f .` — одно и то же действие,
// и ловиться они должны одинаково.

let raw = ""
process.stdin.setEncoding("utf8")
for await (const chunk of process.stdin) raw += chunk

const ok = () => process.exit(0)
const deny = (reason) => {
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason,
            },
        })
    )
    process.exit(0)
}

let payload
try {
    payload = JSON.parse(raw)
} catch {
    ok()
}
if (payload?.tool_name !== "Bash") ok()
const cmd = String(payload?.tool_input?.command ?? "")
if (!cmd.trim()) ok()

// --- нормализация -------------------------------------------------------------

// Тело heredoc — это данные (им в этих репозиториях пишут документацию про сами
// эти команды), а не вызовы.
const noHeredoc = cmd.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\s*\1\s*$/gm, " <<данные>> ")

const unquoted = noHeredoc.replace(/'[^']*'/g, " ").replace(/"[^"]*"/g, " ")

// Ведущее слово команды — мимо присваиваний окружения и обёрток.
const leadingWord = (s) => {
    for (const t of s.trim().split(/\s+/)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue
        if (/^(sudo|env|command|nohup|time|xargs)$/.test(t)) continue
        return t.replace(/.*\//, "")
    }
    return ""
}

// У поисковых и текстовых утилит содержимое кавычек — данные: искать строку про
// опасную команду и писать о ней документацию можно.
const TEXT_ONLY =
    /^(grep|rg|ack|ag|cat|echo|printf|sed|awk|less|head|tail|find|jq|wc|diff|comm|bat|column|sort|uniq)$/
const textual = TEXT_ONLY.test(leadingWord(noHeredoc))

// `git -C <путь>` и `git -c k=v` сути действия не меняют — снимаем их.
const normalizeGit = (s) =>
    s
        .replace(/\bgit\s+((?:-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+)\s+)+/g, "git ")
        .replace(/[ \t]+/g, " ")

const segments = (s) => s.split(/;|&&|\|\||\||\n/)

// --- 1. Уничтожение незакоммиченной работы -----------------------------------
const HOWTO =
    "\nКак надо: отложить работу временным коммитом (`git commit -m wip`), а если без стэша " +
    'никак — `git stash push -u -m "<метка>"`, запомнить SHA через ' +
    "`git stash list --format='%H %gs'` и возвращать через `git stash apply <sha>`.\n" +
    "Если правки действительно надо выбросить — скажи об этом пользователю и дай команду ему."

const WIPES_ALL = (a) => a === "." || a === "./" || a === "*"

const inspect = (form) => {
    for (const seg of segments(form)) {
        const t = seg.trim().split(/\s+/).filter(Boolean)
        if (t[0] !== "git") continue
        const sub = t[1]
        const args = t.slice(2)

        if ((sub === "checkout" || sub === "restore") && args.some(WIPES_ALL))
            return (
                "`git " +
                sub +
                "` по всему дереву затирает незакоммиченные правки без следа. Так уже терялась работа."
            )

        if (sub === "reset" && args.some((a) => a === "--hard"))
            return "`git reset --hard` сносит и индекс, и рабочее дерево."

        if (sub === "clean" && args.some((a) => a === "--force" || /^-[a-zA-Z]*f/.test(a)))
            return "`git clean` с принудительным ключом удаляет неотслеживаемые файлы безвозвратно."

        if (sub === "stash") {
            const first = args[0]
            if (first === "pop" || first === "drop")
                return (
                    "Стек стэша общий со всеми рабочими деревьями: `" +
                    first +
                    "` может снять чужую запись."
                )
            const BARE = ["-u", "--include-untracked", "-k", "--keep-index", "-a", "--all", "save"]
            if (!first || BARE.includes(first))
                return "Голый `git stash` кладёт в общий для всех деревьев стек безымянную запись."
        }
    }
    return null
}

const forms = textual ? [normalizeGit(unquoted)] : [normalizeGit(noHeredoc), normalizeGit(unquoted)]
for (const form of forms) {
    const why = inspect(form)
    if (why) deny(why + HOWTO)
}

// --- 2. Труба, съедающая код возврата ----------------------------------------
// Фильтровать длинный вывод правильно и нужно — контекст не резиновый. Нельзя
// только терять при этом код возврата: pipefail возвращает код первой упавшей
// команды конвейера, без него виден лишь код последней (grep, tail, head).
const VERIFY =
    /\b(pnpm|yarn|npm)\b[^|]*\b(lint|test|typecheck|check|build)\b|\b(vitest|eslint|tsc|jest|pytest)\b|\bgh\s+pr\s+checks\b/

const pipeline = noHeredoc.replace(/\|\|/g, " ")
const firstPipe = pipeline.indexOf("|")
if (firstPipe !== -1 && !textual) {
    // Первое звено берём в сыром виде: `pnpm "test" | tail` — это проверка.
    const before = pipeline.slice(0, firstPipe)
    // pipefail засчитывается, только если объявлен до самой трубы.
    if (!/pipefail/.test(before) && VERIFY.test(before)) {
        deny(
            "Труба съедает код возврата: виден код последней команды конвейера, а не проверки.\n" +
                "Именно так линт объявлялся чистым, будучи красным: `pnpm lint | grep` вернул код grep.\n" +
                "Как надо: `set -o pipefail; <команда> | tail -n 20` — фильтр остаётся, код возврата выживает.\n" +
                "Либо сохранить вывод в файл, напечатать `echo $?` и посмотреть хвост отдельно."
        )
    }
}

ok()
