// Placeholder — to be implemented in the next TDD cycle.
// The real implementation will live here. For now, export a
// minimal stub that satisfies the type signature so the rest of
// the codebase compiles during the IPC-handlers TDD cycle.

export interface SidecarRequestOptions {
  payload: { type: 'extract'; localPath: string }
}

export function parseSidecarEnvelope(_stdout: string): unknown {
  throw new Error('parseSidecarEnvelope: not yet implemented')
}
