// The rules of profiles/draft.schema.json, shared by bin/project-connect, which checks a whole draft
// before it writes a new profile, and bin/profile-set, which checks one field of a profile before it
// writes it: one copy of the checker, so a value the writer of a field accepts is one a new
// connection accepts.
//
//   loadDraftSchema()                 the schema, parsed; throws when the file cannot be read
//   validate(schema, value, at)       the problems of `value` against `schema`: [{ path, kind: "schema", message }],
//                                     empty when it holds; `at` is the path of `value`, the start of each path
//   fieldSchema(profileSchema, field) what the schema says of a dotted field of the profile ("tickets.path"):
//                                     { schema, required, closed } — `schema` the rules of the field (null when
//                                     the schema names no rules for it: any value), `required` true when its
//                                     object requires the key, `closed` true when its object takes no field
//                                     the schema does not name and this is one
//
// The keywords the schema uses: type, enum, const, required, properties, additionalProperties, items,
// minItems, minLength, pattern. Any other keyword is a description, not a rule.
//
// CommonJS, like pipeline.cjs: the scripts of bin/ are CommonJS and `require` it.
"use strict"

const fs = require("node:fs")
const path = require("node:path")

const SCHEMA_FILE = path.join(__dirname, "..", "profiles", "draft.schema.json")

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v)
const TYPES = {
    string: (v) => typeof v === "string",
    number: (v) => typeof v === "number",
    integer: (v) => Number.isInteger(v),
    boolean: (v) => typeof v === "boolean",
    null: (v) => v === null,
    array: Array.isArray,
    object: isObject,
}
const join = (at, key) => (typeof key === "number" ? `${at}[${key}]` : at ? `${at}.${key}` : key)
// Own properties only: a key such as "toString" or "__proto__" is not a field the schema names.
const own = (object, key) => (isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined)

function loadDraftSchema() {
    return JSON.parse(fs.readFileSync(SCHEMA_FILE, "utf8"))
}

function validate(schema, value, at = "") {
    const errors = []
    const fail = (where, message) => errors.push({ path: where, kind: "schema", message })
    const walk = (rules, item, where) => {
        if (rules.const !== undefined && JSON.stringify(rules.const) !== JSON.stringify(item)) return fail(where, `must be ${JSON.stringify(rules.const)}`)
        if (rules.enum && !rules.enum.some((v) => v === item)) return fail(where, `must be one of ${rules.enum.map((v) => JSON.stringify(v)).join(", ")}`)
        if (rules.type) {
            const types = [].concat(rules.type)
            if (!types.some((t) => TYPES[t] && TYPES[t](item))) return fail(where, `must be ${types.join(" or ")}`)
        }
        if (typeof item === "string") {
            if (rules.minLength !== undefined && item.length < rules.minLength) fail(where, "must not be empty")
            if (rules.pattern !== undefined && !new RegExp(rules.pattern, "u").test(item)) fail(where, `must match the pattern ${JSON.stringify(rules.pattern)}`)
        }
        if (Array.isArray(item)) {
            if (rules.minItems !== undefined && item.length < rules.minItems) fail(where, `must have at least ${rules.minItems} item(s)`)
            if (rules.items) item.forEach((each, i) => walk(rules.items, each, join(where, i)))
        }
        if (isObject(item)) {
            for (const key of rules.required || []) if (!Object.hasOwn(item, key)) fail(join(where, key), "is required")
            for (const [key, each] of Object.entries(item)) {
                const inner = own(rules.properties, key)
                if (inner !== undefined) walk(inner, each, join(where, key))
                else if (rules.additionalProperties === false) fail(join(where, key), "is not a field the schema allows")
            }
        }
    }
    walk(schema, value, at)
    return errors
}

function fieldSchema(profileSchema, field) {
    let rules = profileSchema
    let required = false
    for (const key of field.split(".")) {
        // Below a field the schema does not describe: any value, as the schema has no rules there.
        if (rules === null) return { schema: null, required: false, closed: false }
        const inner = own(rules.properties, key)
        if (inner === undefined && rules.additionalProperties === false) return { schema: null, required: false, closed: true }
        required = (rules.required || []).includes(key)
        rules = inner === undefined ? null : inner
    }
    return { schema: rules, required, closed: false }
}

module.exports = { SCHEMA_FILE, loadDraftSchema, validate, fieldSchema, isObject }
