// A Card's own data (ticket 26): one JSON value per Card, at most CARD_DATA_LIMIT_BYTES, in
// <Project data folder>/card-data/<card id>.json — worfy's own state, never the Project's
// repository (ADR-0005). The Card reaches it only through window.worfy.data (the Card API); the
// file is written atomically and read back through the same schema (src/main/storage/json-file.ts).
import { join } from 'node:path'
import { cardDataSchema, jsonByteLength, type CardData } from '../../shared/cards/bridge'
import { CARD_ID_PATTERN } from '../../shared/ipc/cards'
import { projectStore } from '../projects/store'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

/** The folder of the Cards' data, inside a Project's data folder. */
export const CARD_DATA_DIR = 'card-data'

export class CardDataStore {
  /** `dataDirOf` throws for a Project that is not in the list. Does no I/O. */
  constructor(private readonly dataDirOf: (projectId: string) => string) {}

  /** The file of one Card's data. Throws for an invalid Card id or an unknown Project. */
  file(projectId: string, cardId: string): string {
    if (!CARD_ID_PATTERN.test(cardId)) throw new Error(`${cardId} is not a valid Card id`)
    return join(this.dataDirOf(projectId), CARD_DATA_DIR, `${cardId}.json`)
  }

  /** The Card's data; null when it has stored none (or its file could not be read and was set aside). */
  get(projectId: string, cardId: string): CardData {
    return readJsonFile(this.file(projectId, cardId), cardDataSchema) ?? null
  }

  /** Replaces the Card's data. A value over the limit or not JSON throws before anything is written. Returns its size. */
  set(projectId: string, cardId: string, value: CardData): number {
    const file = this.file(projectId, cardId)
    writeJsonFile(file, cardDataSchema, value)
    return jsonByteLength(value)
  }
}

let shared: CardDataStore | undefined

/** The store of the running app, over the Projects' data folders. */
export function cardDataStore(): CardDataStore {
  shared ??= new CardDataStore((projectId) => {
    const projects = projectStore()
    return projects.dataDir(projects.get(projectId).id)
  })
  return shared
}
