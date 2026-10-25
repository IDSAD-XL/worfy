// The address the window loads a Canvas image from (worfy-canvas ticket 23): worfy-image://
// canvas.<project label>[.<machine label>]/<file> (src/shared/images.ts). In a window on a Linked
// machine the address names that Machine: main answers it with a 404 until reading through the link
// (worfy-canvas ticket 24), and the Node shows its "Image not available" plate.
import { machineLabel } from '../../../shared/cards/bridge'
import { canvasImageUrl } from '../../../shared/images'
import { windowMachine } from '../../ipc'

/** Null when the Project id has no project label, or the window's Linked machine has no machine label: never this Machine's address for another's image. */
export function imageSrc(projectId: string, file: string): string | null {
  const machine = windowMachine()
  const label = machine === null ? null : machineLabel(machine)
  return machine !== null && label === null ? null : canvasImageUrl(projectId, file, label)
}
