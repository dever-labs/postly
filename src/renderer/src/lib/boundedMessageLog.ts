import { MAX_STREAM_EVENTS } from '../../../shared/stream'

export interface BoundedMessageLog<T> {
  items: T[]
  dropped: number
}

export function appendBoundedMessages<T>(
  current: BoundedMessageLog<T>,
  incoming: T[],
  maxItems = MAX_STREAM_EVENTS,
): BoundedMessageLog<T> {
  if (incoming.length === 0) return current
  let items = current.items.concat(incoming)
  let dropped = current.dropped
  if (items.length > maxItems) {
    dropped += items.length - maxItems
    items = items.slice(items.length - maxItems)
  }
  return { items, dropped }
}

export function clearBoundedMessages<T>(): BoundedMessageLog<T> {
  return { items: [], dropped: 0 }
}
