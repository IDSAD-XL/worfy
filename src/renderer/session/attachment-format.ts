// How an attachment chip names a file (worfy-ui ticket 28): the kind of document its icon shows, its
// format and its size. Shared by the chips of a sent message (MessageAttachments.tsx) and of the
// input field (MessageInput.tsx).

/** The kinds of document a chip tells apart by its icon. */
export type DocumentKind = 'pdf' | 'text' | 'code' | 'sheet' | 'archive' | 'other'

const KINDS: Readonly<Record<Exclude<DocumentKind, 'other'>, readonly string[]>> = {
  pdf: ['pdf'],
  text: ['txt', 'md', 'markdown', 'rtf', 'log', 'doc', 'docx', 'odt', 'pages'],
  code: [
    ...['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'lua'],
    ...['sh', 'bash', 'zsh', 'ps1', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'scss', 'sql', 'svg'],
  ],
  sheet: ['csv', 'tsv', 'xls', 'xlsx', 'ods', 'numbers'],
  archive: ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst'],
}

/** The kind of document an extension (lower case, without the dot) stands for. */
export function documentKind(ext: string): DocumentKind {
  for (const [kind, extensions] of Object.entries(KINDS) as [DocumentKind, readonly string[]][]) if (extensions.includes(ext)) return kind
  return 'other'
}

/** The format a chip shows: the extension in capitals, «FILE» for a name without one. */
export const formatLabel = (ext: string): string => (ext === '' ? 'FILE' : ext.toUpperCase())

/** A size for a chip: bytes, KB or MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}
