export type UnsavedDecision = 'save' | 'discard' | 'cancel'

export function decisionFromDialog(response: number): UnsavedDecision {
  return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
}
