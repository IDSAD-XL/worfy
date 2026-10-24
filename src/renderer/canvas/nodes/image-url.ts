// The address the window loads a Canvas image from (worfy-canvas ticket 23).
// PENDING: the image protocol of worfy-ui ticket 28 is not on main yet; until it is, no address.
export function canvasImageUrl(...address: [projectId: string, file: string]): string | null {
  void address
  return null
}
