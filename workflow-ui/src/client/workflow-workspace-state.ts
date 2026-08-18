import { useSyncExternalStore } from 'react'

let openRequest = 0
const listeners = new Set<() => void>()

/** Ask the shell overlay to reveal the workflow workspace. */
export function requestWorkflowWorkspaceOpen(): void {
  openRequest += 1
  for (const listener of listeners) listener()
}

/** Subscribe to header-action requests without coupling the two slot trees. */
export function useWorkflowWorkspaceRequest(): number {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    () => openRequest,
    () => 0,
  )
}
