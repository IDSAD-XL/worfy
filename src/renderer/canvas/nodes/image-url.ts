// The address the window loads a Canvas image from (worfy-canvas ticket 23): worfy-image://
// canvas.<project label>[.<machine label>]/<file> (src/shared/images.ts). In a window on a Linked
// machine the address names that Machine, and main fetches the image from it over the link
// (worfy-canvas ticket 24, src/main/images/remote.ts).
import { machineLabel } from '../../../shared/cards/bridge'
import { canvasImageUrl } from '../../../shared/images'
import { imageStatusSchema, type ImageStatus } from '../../../shared/ipc/images'
import { invoke, windowMachine } from '../../ipc'

/** Null when the Project id has no project label, or the window's Linked machine has no machine label: never this Machine's address for another's image. */
export function imageSrc(projectId: string, file: string): string | null {
  const machine = windowMachine()
  const label = machine === null ? null : machineLabel(machine)
  return machine !== null && label === null ? null : canvasImageUrl(projectId, file, label)
}

/** Whether the window shows a Linked machine's Canvas: its images are only shown there, never changed. */
export const imagesOfLinkedMachine = (): boolean => windowMachine() !== null

/** Why the image at `src` did not load, as main tells it (images.status); `missing` when main cannot tell. */
export async function imageFailure(src: string): Promise<ImageStatus> {
  const result = await invoke('images.status', { url: src })
  return result.ok ? imageStatusSchema.parse(result.value) : 'missing'
}
