// The messages between a Terminal's zsh and main over the socket of Terminal AI (socket.ts; the
// shell's side is src/main/terminal/zsh/rc.d/10-assist.zsh).
//
// One message is one line. Its fields are separated by TAB; the first is the kind. In a field `\`
// is written `\\`, a line feed `\n`, a TAB `\t` and a carriage return `\r`, so a field never holds
// a separator; zsh reads and writes that with its own means, without a process per message.
//
//   shell → main   hello <token>                 the first message of a connection
//                  ask <id> <feature> <line>     asks for a feature about the line being edited
//                  cancel <id>                   the ask is no longer wanted
//                  bye                           the shell closes the connection (before a command);
//                                                main closes it too, for every copy of the descriptor
//   main → shell   show <id> <text>              grey text after the line (a Suggestion), for that ask
//                  status <id> <text>            a short grey note instead; id 0 is about no ask
//                  insert <text>                 the line becomes the text; nothing is run
//                  config <features>             the features the settings have on, separated by spaces
//
// An id is a positive integer the shell counts up; the shell shows a `show` only for the ask that
// is still open, so an answer to an older ask is dropped there.

/** The longest line either side sends or reads; a longer one is not a message. */
export const MAX_LINE_BYTES = 64 * 1024

/** A feature's name in `ask` and `config`: the shell uses it as the key of a table. */
const FEATURE_NAME = /^[a-z][a-z0-9-]*$/
const MAX_ID = 2 ** 31 - 1

export type ShellMessage =
  | { type: 'hello'; token: string }
  | { type: 'ask'; id: number; feature: string; line: string }
  | { type: 'cancel'; id: number }
  | { type: 'bye' }

export type MainMessage =
  | { type: 'show'; id: number; text: string }
  | { type: 'status'; id: number; text: string }
  | { type: 'insert'; text: string }
  | { type: 'config'; features: string[] }

const ESCAPES: Readonly<Record<string, string>> = { '\\': '\\\\', '\n': '\\n', '\t': '\\t', '\r': '\\r' }
const UNESCAPES: Readonly<Record<string, string>> = { '\\': '\\', n: '\n', t: '\t', r: '\r' }

/** A field as it goes on the line. */
export function encodeField(text: string): string {
  return text.replace(/[\\\n\t\r]/g, (char) => ESCAPES[char] ?? char)
}

/** A field as it was before encodeField; an escape that is not one of the four stays as written. */
export function decodeField(field: string): string {
  return field.replace(/\\([\\ntr])/g, (_, char: string) => UNESCAPES[char] ?? char)
}

export function isFeatureName(name: string): boolean {
  return FEATURE_NAME.test(name)
}

function fieldsOf(message: ShellMessage | MainMessage): string[] {
  switch (message.type) {
    case 'hello':
      return [message.token]
    case 'ask':
      return [String(message.id), message.feature, message.line]
    case 'cancel':
      return [String(message.id)]
    case 'bye':
      return []
    case 'show':
    case 'status':
      return [String(message.id), message.text]
    case 'insert':
      return [message.text]
    case 'config':
      return [message.features.filter(isFeatureName).join(' ')]
  }
}

/** The line of a message, without the line feed that ends it. */
export function encodeMessage(message: ShellMessage | MainMessage): string {
  return [message.type, ...fieldsOf(message).map(encodeField)].join('\t')
}

/** The id in a field: a whole number from `least` up, written in digits only. */
function idOf(field: string | undefined, least: number): number | null {
  if (field === undefined || !/^\d{1,10}$/.test(field)) return null
  const id = Number(field)
  return id >= least && id <= MAX_ID ? id : null
}

function split(line: string): { type: string; fields: string[] } {
  const [type = '', ...fields] = line.split('\t')
  return { type, fields: fields.map(decodeField) }
}

/** What the shell sent in one line; null when it is not a message of the protocol. */
export function parseShellMessage(line: string): ShellMessage | null {
  const { type, fields } = split(line)
  switch (type) {
    case 'hello': {
      const [token] = fields
      return fields.length === 1 && token !== undefined && token !== '' ? { type, token } : null
    }
    case 'ask': {
      const [, feature, text] = fields
      const id = idOf(fields[0], 1)
      if (fields.length !== 3 || id === null || feature === undefined || !isFeatureName(feature) || text === undefined) return null
      return { type, id, feature, line: text }
    }
    case 'cancel': {
      const id = idOf(fields[0], 1)
      return fields.length === 1 && id !== null ? { type, id } : null
    }
    case 'bye':
      return fields.length === 0 ? { type } : null
    default:
      return null
  }
}

/** What main sent in one line; null when it is not a message of the protocol. */
export function parseMainMessage(line: string): MainMessage | null {
  const { type, fields } = split(line)
  switch (type) {
    case 'show':
    case 'status': {
      const id = idOf(fields[0], type === 'show' ? 1 : 0)
      const [, text] = fields
      return fields.length === 2 && id !== null && text !== undefined ? { type, id, text } : null
    }
    case 'insert': {
      const [text] = fields
      return fields.length === 1 && text !== undefined ? { type, text } : null
    }
    case 'config': {
      const [list] = fields
      if (fields.length !== 1 || list === undefined) return null
      const features = list.split(' ').filter((name) => name !== '')
      return features.every(isFeatureName) ? { type, features } : null
    }
    default:
      return null
  }
}
