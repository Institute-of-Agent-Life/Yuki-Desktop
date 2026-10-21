export interface NavigationAttempt {
  proceed(): void
  cancel(): void
}
let guard: ((attempt: NavigationAttempt) => boolean) | undefined
let bypass = false

export function guardNavigation(value: NonNullable<typeof guard>) {
  guard = value
  return () => {
    if (guard === value) guard = undefined
  }
}
export function requestNavigation(action: () => void, cancel: () => void = () => {}) {
  const proceed = () => {
    const previous = bypass
    bypass = true
    try {
      action()
    } finally {
      bypass = previous
    }
  }
  if (!bypass && guard?.({ proceed, cancel })) return
  proceed()
}
