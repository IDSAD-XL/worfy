import { PermissionCard } from '../PermissionCard'
import type { TranscriptRowProps } from './index'

// A permission request of a live Session (ticket 21), drawn as its card (../PermissionCard.tsx).
export const eventType = 'permission_request'

export default function PermissionRequest({ event, sessionId }: TranscriptRowProps) {
  if (event.type !== 'permission_request') return null
  return <PermissionCard request={event} sessionId={sessionId} />
}
