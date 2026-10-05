#!/usr/bin/env node
// Сопоставляет изменённые файлы с воркспейсами, которым они принадлежат.
//
//   gate-resolve.mjs --which <path>          -> TSV: key \t repoRoot \t pm   (или пусто)
//   <изменённые пути> | gate-resolve.mjs <repoPath> <profile> <key>
//                                            -> TSV: wsdir \t packageName \t "script1 script2"
//                                                    \t "пути для отпечатка" \t "добавлен от"
//                                               ("." + пустое имя = корень репозитория;
//                                                у корня два последних поля отсутствуют)
//                                               В набор входят и воркспейсы, зависящие
//                                               от изменённых (транзитивно).
//   GATE_ALL=1 ... gate-resolve.mjs <repoPath> <profile> <key>
//                                            -> то же, но все воркспейсы и корень, без
//                                               оглядки на список изменений
//
// Пустое второе поле у корня — причина, по которой в gate.sh нельзя разбирать
// строку через IFS=$'\t' read: таб — пробельный разделитель, два подряд
// схлопываются, и имя скрипта уезжает в поле пакета.

import fs from "node:fs"
import path from "node:path"

const CFG =
    process.env.CLAUDE_GATE_CONFIG || path.join(process.env.HOME, ".claude/gate/config.json")

// Нечитаемый или битый реестр — это не «проект не зарегистрирован». Раньше здесь был
// `exit 0` с пустым выводом, и gate.sh/stop.sh принимали зарегистрированный проект за
// чужой: гейт отвечал «не зарегистрирован», а stop.sh не замечал красного маркера.
// Теперь — код 4 и причина в stderr; вызывающие считают это «проверить не удалось».
let cfg
try {
    cfg = JSON.parse(fs.readFileSync(CFG, "utf8"))
} catch (e) {
    process.stderr.write(`gate-resolve: реестр ${CFG} не читается: ${e.message}\n`)
    process.exit(4)
}
// Нет поля `repos` (`{}`, опечатка `"Repos"`) — тоже битый реестр, а не пустой: иначе все
// проекты молча стали бы «не зарегистрированы», а красный маркер перестал бы держать ход.
if (!cfg || typeof cfg !== "object" || !Array.isArray(cfg.repos)) {
    process.stderr.write(`gate-resolve: реестр ${CFG} битый: поле "repos" должно быть массивом\n`)
    process.exit(4)
}
const repos = cfg.repos

const readPkg = (p) => {
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"))
    } catch {
        return null
    }
}

// --- выбор репозитория: побеждает самое длинное совпадение префикса ------------
if (process.argv[2] === "--which") {
    let target = process.argv[3] || process.cwd()
    try {
        target = fs.realpathSync(target)
    } catch {}
    const hit = repos
        .filter((r) => target === r.match || target.startsWith(r.match + path.sep))
        .sort((a, b) => b.match.length - a.match.length)[0]
    if (hit) console.log([hit.key, hit.match, hit.pm || "npm"].join("\t"))
    process.exit(0)
}

const [, , repoPath, profile, key] = process.argv
const rc = repos.find((r) => r.key === key)
if (!rc || !repoPath) process.exit(0)

// Режим «всё»: gate.sh не доверяет диффу от merge-base (базы нет, HEAD
// отсоединён, ветка далеко от origin/main) и просит полный набор.
const ALL = process.env.GATE_ALL === "1"
const changed = fs
    .readFileSync(0, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
if (!changed.length && !ALL) process.exit(0)

const pick = (table) => (table && (table[profile] || [])) || []
const rootWanted = pick(rc.root)
// Корневые скрипты незачем гонять из-за одних только документов: root_if
// ограничивает их путями, которые эти скрипты вообще смотрят.
const rootIf = rc.root_if ? new RegExp(rc.root_if) : null
const rootApplies = ALL || !rootIf || changed.some((f) => rootIf.test(f))
const wsWanted = pick(rc.workspace)

// --- где живут воркспейсы -----------------------------------------------------
// Записи бывают буквальные ("shared") и с хвостовой звездой ("apps/*"). Ничего
// сложнее звезды в конце здесь не разбирается — таких записей в наших
// репозиториях нет, а полноценный glob потянул бы зависимость в хук.
function workspaceGlobs() {
    const yaml = path.join(repoPath, "pnpm-workspace.yaml")
    if (fs.existsSync(yaml)) {
        const out = []
        let inList = false
        for (const raw of fs.readFileSync(yaml, "utf8").split("\n")) {
            if (/^packages:\s*$/.test(raw)) {
                inList = true
                continue
            }
            if (inList) {
                const m = raw.match(/^\s+-\s*['"]?([^'"#\s]+)['"]?\s*$/)
                if (m) out.push(m[1])
                else if (/^\S/.test(raw)) inList = false
            }
        }
        return out
    }
    const root = readPkg(path.join(repoPath, "package.json"))
    const ws = root?.workspaces
    return Array.isArray(ws) ? ws : ws?.packages || []
}

function workspaceDirs() {
    const dirs = []
    for (const g of workspaceGlobs()) {
        if (g.endsWith("/*")) {
            const parent = g.slice(0, -2)
            let entries = []
            try {
                entries = fs.readdirSync(path.join(repoPath, parent), { withFileTypes: true })
            } catch {}
            for (const e of entries) {
                if (!e.isDirectory()) continue
                const d = `${parent}/${e.name}`
                if (fs.existsSync(path.join(repoPath, d, "package.json"))) dirs.push(d)
            }
        } else if (fs.existsSync(path.join(repoPath, g, "package.json"))) {
            dirs.push(g)
        }
    }
    return dirs.sort((a, b) => b.length - a.length) // сначала самый длинный путь
}

const dirs = wsWanted.length ? workspaceDirs() : []
const hit = new Set(ALL ? dirs : [])
const uncovered = []
for (const file of ALL ? [] : changed) {
    const owner = dirs.find((d) => file === d || file.startsWith(d + "/"))
    if (owner) hit.add(owner)
    else uncovered.push(file)
}

// --- граф зависимостей между воркспейсами -----------------------------------------
// Изменённый пакет ломает тех, кто его импортирует: ветка сменила тип в
// packages/shared, гейт проверил shared, api и web, а demo-bot, который тоже
// зависит от shared, остался непроверенным и красным на typecheck. Поэтому в
// набор добавляются все воркспейсы, зависящие от изменённых, транзитивно.
// Зависимость — имя другого воркспейса в dependencies/devDependencies/
// peerDependencies/optionalDependencies с любой версией (workspace:* или нет).
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
const pkgOf = new Map(dirs.map((d) => [d, readPkg(path.join(repoPath, d, "package.json"))]))
const dirByName = new Map()
for (const [d, p] of pkgOf) if (p?.name) dirByName.set(p.name, d)
const depsOf = new Map() // dir -> прямые зависимости-воркспейсы (dirs)
for (const [d, p] of pkgOf) {
    const out = new Set()
    for (const f of DEP_FIELDS)
        for (const name of Object.keys(p?.[f] || {})) {
            const dd = dirByName.get(name)
            if (dd && dd !== d) out.add(dd)
        }
    depsOf.set(d, out)
}
const closure = (d) => {
    // все воркспейсы, от которых d зависит транзитивно (без самого d)
    const seen = new Set()
    const stack = [...(depsOf.get(d) || [])]
    while (stack.length) {
        const x = stack.pop()
        if (seen.has(x) || x === d) continue
        seen.add(x)
        stack.push(...(depsOf.get(x) || []))
    }
    return seen
}
const direct = new Set(hit)
const addedFrom = new Map() // dir -> изменённые пакеты, из-за которых он добавлен
if (!ALL) {
    for (const d of dirs) {
        if (direct.has(d)) continue
        const from = [...closure(d)].filter((x) => direct.has(x)).sort()
        if (from.length) {
            hit.add(d)
            addedFrom.set(d, from)
        }
    }
}

// --- вывод --------------------------------------------------------------------
if (rootWanted.length && rootApplies) {
    const pkg = readPkg(path.join(repoPath, "package.json"))
    const scripts = rootWanted.filter((s) => pkg?.scripts?.[s])
    if (scripts.length) console.log([".", "", scripts.join(" ")].join("\t"))
}

for (const dir of [...hit].sort()) {
    const pkg = readPkg(path.join(repoPath, dir, "package.json"))
    if (!pkg?.name) continue
    // Точечное послабление: воркспейс, которому в этом профиле положен свой набор.
    const wanted = pick(rc.workspace_overrides?.[dir]) || wsWanted
    const scripts = (wanted.length ? wanted : wsWanted).filter((s) => pkg.scripts?.[s])
    // Четвёртое поле — пути для отпечатка кэша: сам пакет и все его зависимости-
    // воркспейсы. Иначе незакоммиченная правка в shared не меняла отпечаток
    // demo-bot, и кэш выдавал старое «зелено». Пятое — от чего пакет добавлен
    // как зависимый (пусто, если он изменён сам).
    const fpScope = [dir, ...[...closure(dir)].sort()].join(" ")
    const from = (addedFrom.get(dir) || []).join(",")
    if (scripts.length) console.log([dir, pkg.name, scripts.join(" "), fpScope, from].join("\t"))
}

// Корневые скрипты покрывают весь репозиторий, поэтому «ничей» файл — проблема
// только там, где корневых скриптов нет вовсе. Отсев по root_if — решение
// осознанное (документы линтеру не нужны), и жаловаться на него незачем.
if (uncovered.length && !rootWanted.length) {
    process.stderr.write(
        `[gate] ${key}: изменений вне воркспейсов и без корневых скриптов: ${uncovered.length} — ` +
            uncovered.slice(0, 5).join(", ") +
            (uncovered.length > 5 ? ", ..." : "") +
            "\n"
    )
}
