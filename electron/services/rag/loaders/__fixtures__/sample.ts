// Sample TypeScript fixture for loader + chunker integration tests.
// The content shape mirrors a real source file: a small set of declarations
// followed by one function. Total length is comfortably above the chunker's
// MIN_CHUNK_CHARS floor.

export interface SampleConfig {
  name: string
  retries: number
}

export const DEFAULT_RETRIES = 3

export function describeConfig(cfg: SampleConfig): string {
  return `${cfg.name} (retries=${cfg.retries})`
}
