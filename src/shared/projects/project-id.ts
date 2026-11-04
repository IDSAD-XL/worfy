// The form of a Project id, `<folder name>-<sha256(path)[0:8]>` (projectId() of
// src/main/projects/store.ts), for the code on both sides that has to recognise one: the Auto-approval
// modes of app-settings.json are kept by Project id (src/shared/settings/app-settings.ts), and an id
// the setting did not recognise would read as Off without a word. One pattern for both, so a change of
// the id's form changes both.

/** Hex characters of the path hash that ends every Project id. */
export const PROJECT_ID_HASH_LENGTH = 8

/** The path hash at the end of a Project id, as group 1. No `g` flag: test() and exec() keep no state. */
export const PROJECT_ID_HASH_SUFFIX = new RegExp(`-([0-9a-f]{${PROJECT_ID_HASH_LENGTH}})$`, 'u')
