// The warning about a folder inside the Windows %TEMP% (worfy-windows ticket 61): main tells which
// folders lie there (src/main/projects/temp-folder.ts), the renderer shows this sign and text on the
// "Folder" step of "Add project" and on the gate badge of such a worktree.

/** The label of the sign. */
export const TEMP_FOLDER_LABEL = 'in %TEMP%'

/** Why it matters and what to do; adding the folder stays allowed. */
export const TEMP_FOLDER_WARNING =
  'This folder is inside the Windows temporary folder (%TEMP%). Storage Sense may delete files from it when the disk runs low, packages in node_modules among them. Move the checkout to a folder outside %TEMP%.'
