import { useCallback, useEffect, useState } from 'react'

// Persistence Phase / PS10 — the Settings panel that surfaces every
// PS1–PS9 lever and live status.
//
// Read sections:
//   - DB / WAL / SHM file sizes (PS2).
//   - Last WAL checkpoint result (PS2): ok flag, pages moved, duration.
//   - Last integrity check (PS4): ok flag, raw result, timestamp.
//   - Backup directory + latest backup metadata (PS5).
//   - Encryption status (PS9): binding available, db encrypted,
//     passphrase stored.
//
// Action sections:
//   - "Run integrity check now" — re-runs PRAGMA integrity_check on
//     demand (PS4). Useful after a suspected corruption.
//   - "Force checkpoint now" — runs wal_checkpoint(TRUNCATE) on demand
//     (PS2). Visible WAL shrinkage in the status above proves the call.
//   - "Create backup now" — async snapshot (PS5).
//   - "Restore from backup…" — list of backups; click one to restore.
//     Atomic file swap + relaunch prompt.
//   - Encryption: enable + disable + change-passphrase forms,
//     conditional on bindingAvailable.

interface CheckpointResult {
  ok: boolean
  pagesInWal: number
  pagesCheckpointed: number
  durationMs: number
}

interface IntegrityCheckResult {
  ok: boolean
  result: string
  ranAt: number
  durationMs: number
}

interface BackupInfo {
  path: string
  name: string
  mtime: number
  bytes: number
}

interface PersistenceStatus {
  dbPath: string
  dbBytes: number | null
  walBytes: number | null
  shmBytes: number | null
  lastCheckpoint: CheckpointResult | null
  lastIntegrity: IntegrityCheckResult | null
  backupDir: string
  backupCount: number
  latestBackup: BackupInfo | null
}

interface EncryptionStatus {
  bindingAvailable: boolean
  bindingError: string | null
  databaseEncrypted: boolean
  passphraseStored: boolean
}

function formatBytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTimestamp(ms: number | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-mono text-[var(--text-primary)]">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 border-b border-[var(--panel-border)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {title}
      </div>
      {children}
    </div>
  )
}

export function PersistenceSettings(): React.ReactElement {
  const [status, setStatus] = useState<PersistenceStatus | null>(null)
  const [encryption, setEncryption] = useState<EncryptionStatus | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Encryption form state
  const [encryptPassphrase, setEncryptPassphrase] = useState('')
  const [encryptConfirm, setEncryptConfirm] = useState('')
  const [decryptPassphrase, setDecryptPassphrase] = useState('')

  const refresh = useCallback(async () => {
    if (!window.api?.persistence) return
    try {
      const [s, e, b] = await Promise.all([
        window.api.persistence.getStatus(),
        window.api.persistence.getEncryptionStatus(),
        window.api.persistence.listBackups()
      ])
      if (s.success) setStatus(s.data)
      if (e.success) setEncryption(e.data)
      if (b.success) setBackups(b.data)
    } catch (err: any) {
      setError(err?.message ?? String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runAction = async (
    label: string,
    fn: () => Promise<{ success: boolean; data?: unknown; error?: string }>,
    onSuccess?: (data: unknown) => void
  ): Promise<void> => {
    setBusy(label)
    setError(null)
    setInfo(null)
    try {
      const result = await fn()
      if (!result.success) {
        setError(result.error ?? `${label} failed`)
        return
      }
      setInfo(`${label} complete.`)
      onSuccess?.(result.data)
      await refresh()
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setBusy(null)
    }
  }

  if (!window.api?.persistence) {
    return (
      <div className="text-xs text-[var(--text-muted)]">
        Persistence APIs unavailable — this view requires the Electron preload
        bridge.
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3 rounded border border-[var(--error)] bg-[var(--error)]/10 px-2 py-1 text-xs text-[var(--text-primary)]">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-3 rounded border border-[var(--success)] bg-[var(--success)]/10 px-2 py-1 text-xs text-[var(--text-primary)]">
          {info}
        </div>
      )}

      <Section title="Database files">
        <StatusRow label="Path" value={status?.dbPath ?? '—'} />
        <StatusRow label="Main DB" value={formatBytes(status?.dbBytes ?? null)} />
        <StatusRow label="WAL" value={formatBytes(status?.walBytes ?? null)} />
        <StatusRow label="SHM" value={formatBytes(status?.shmBytes ?? null)} />
      </Section>

      <Section title="Last checkpoint (PS2)">
        <StatusRow
          label="Result"
          value={
            status?.lastCheckpoint
              ? status.lastCheckpoint.ok
                ? `ok — ${status.lastCheckpoint.pagesCheckpointed} of ${status.lastCheckpoint.pagesInWal} pages moved`
                : `busy (no pages moved)`
              : 'no checkpoint yet'
          }
        />
        <StatusRow
          label="Duration"
          value={status?.lastCheckpoint ? `${status.lastCheckpoint.durationMs} ms` : '—'}
        />
        <div className="mt-2">
          <button
            disabled={busy !== null}
            onClick={() =>
              runAction('Force checkpoint', () => window.api.persistence.forceCheckpoint())
            }
            className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
          >
            {busy === 'Force checkpoint' ? 'Checkpointing…' : 'Force checkpoint now'}
          </button>
        </div>
      </Section>

      <Section title="Last integrity check (PS4)">
        <StatusRow
          label="Result"
          value={
            status?.lastIntegrity ? (
              status.lastIntegrity.ok ? (
                <span className="text-[var(--success)]">ok</span>
              ) : (
                <span className="text-[var(--error)]">{status.lastIntegrity.result}</span>
              )
            ) : (
              'never run'
            )
          }
        />
        <StatusRow label="Ran at" value={formatTimestamp(status?.lastIntegrity?.ranAt)} />
        <StatusRow
          label="Duration"
          value={status?.lastIntegrity ? `${status.lastIntegrity.durationMs} ms` : '—'}
        />
        <div className="mt-2">
          <button
            disabled={busy !== null}
            onClick={() =>
              runAction('Run integrity check', () =>
                window.api.persistence.runIntegrityCheck()
              )
            }
            className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
          >
            {busy === 'Run integrity check' ? 'Checking…' : 'Run integrity check now'}
          </button>
        </div>
      </Section>

      <Section title={`Backups (PS5) — ${status?.backupCount ?? 0} kept`}>
        <StatusRow label="Backup directory" value={status?.backupDir ?? '—'} />
        <StatusRow
          label="Latest backup"
          value={
            status?.latestBackup
              ? `${status.latestBackup.name} (${formatBytes(status.latestBackup.bytes)})`
              : 'none'
          }
        />
        <StatusRow
          label="Latest backup time"
          value={formatTimestamp(status?.latestBackup?.mtime)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            disabled={busy !== null}
            onClick={() =>
              runAction('Create backup', () => window.api.persistence.createBackup())
            }
            className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
          >
            {busy === 'Create backup' ? 'Backing up…' : 'Create backup now'}
          </button>
        </div>
        {backups.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
              Restore from backup ({backups.length} available)
            </summary>
            <ul className="mt-2 space-y-1">
              {backups.map((b) => (
                <li
                  key={b.path}
                  className="flex items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1 text-xs"
                >
                  <span>
                    <span className="font-mono">{b.name}</span>{' '}
                    <span className="text-[var(--text-muted)]">
                      ({formatBytes(b.bytes)} · {formatTimestamp(b.mtime)})
                    </span>
                  </span>
                  <button
                    disabled={busy !== null}
                    onClick={() =>
                      runAction(`Restore ${b.name}`, () =>
                        window.api.persistence.restoreFromBackup(b.path)
                      )
                    }
                    className="rounded border border-[var(--warning)] bg-[var(--warning)]/10 px-2 py-0.5 text-xs hover:bg-[var(--warning)]/20 disabled:opacity-40"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="Encryption (PS9)">
        {encryption === null ? (
          <div className="text-xs text-[var(--text-muted)]">loading…</div>
        ) : !encryption.bindingAvailable ? (
          <div className="rounded border border-[var(--border)] bg-[var(--bg-tertiary)] p-2 text-xs">
            <div className="mb-1 font-semibold">SQLCipher binding not installed</div>
            <div className="text-[var(--text-muted)]">
              Install{' '}
              <span className="font-mono">better-sqlite3-multiple-ciphers</span> to
              enable at-rest encryption. The toggle stays hidden until the binding
              is present.
            </div>
            {encryption.bindingError && (
              <div className="mt-1 font-mono text-[var(--text-muted)]">
                {encryption.bindingError}
              </div>
            )}
          </div>
        ) : (
          <>
            <StatusRow
              label="Status"
              value={
                encryption.databaseEncrypted ? (
                  <span className="text-[var(--success)]">encrypted</span>
                ) : (
                  'plaintext'
                )
              }
            />
            {!encryption.databaseEncrypted ? (
              <div className="mt-2 space-y-2">
                <input
                  type="password"
                  placeholder="New passphrase (min 8 chars)"
                  value={encryptPassphrase}
                  onChange={(e) => setEncryptPassphrase(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
                />
                <input
                  type="password"
                  placeholder="Confirm passphrase"
                  value={encryptConfirm}
                  onChange={(e) => setEncryptConfirm(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
                />
                <button
                  disabled={
                    busy !== null ||
                    encryptPassphrase.length < 8 ||
                    encryptPassphrase !== encryptConfirm
                  }
                  onClick={() =>
                    runAction('Encrypt database', () =>
                      window.api.persistence.enableEncryption(encryptPassphrase)
                    )
                  }
                  className="rounded border border-[var(--error)] bg-[var(--error)]/10 px-2 py-1 text-xs hover:bg-[var(--error)]/20 disabled:opacity-40"
                >
                  {busy === 'Encrypt database' ? 'Encrypting…' : 'Encrypt database'}
                </button>
                <div className="text-[var(--text-muted)]">
                  Requires app relaunch. The plaintext file is moved aside as a
                  timestamped backup so you can roll back manually if needed.
                </div>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <input
                  type="password"
                  placeholder="Current passphrase"
                  value={decryptPassphrase}
                  onChange={(e) => setDecryptPassphrase(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
                />
                <button
                  disabled={busy !== null || decryptPassphrase.length === 0}
                  onClick={() =>
                    runAction('Decrypt database', () =>
                      window.api.persistence.disableEncryption(decryptPassphrase)
                    )
                  }
                  className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
                >
                  {busy === 'Decrypt database' ? 'Decrypting…' : 'Decrypt database'}
                </button>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  )
}
