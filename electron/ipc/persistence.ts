import { ipcMain, app } from 'electron'
import { join } from 'path'
import { statSync } from 'fs'
import {
  checkpoint,
  getLastCheckpointResult,
  runIntegrityCheck,
  getLastIntegrityResult,
  type CheckpointResult,
  type IntegrityCheckResult
} from '../services/database'
import {
  createBackup,
  listBackups,
  restoreFromBackup,
  type BackupInfo
} from '../services/backup-runner'
import {
  getEncryptionStatus,
  enableEncryption,
  disableEncryption,
  changePassphrase,
  type EncryptionStatus
} from '../services/db-encryption'

// Persistence Phase / PS4 (+ PS5 + PS10) — read-write IPC for the
// persistence floor. Three surface categories:
//   - PS4: integrity check status + on-demand re-run
//   - PS5: backup list + create + restore + retention status
//   - PS10: live stats (DB size, WAL size, last checkpoint, last backup,
//           last integrity_check) + on-demand force checkpoint
//
// All handlers follow the project's `{ success, data }` / `{ success: false,
// error }` envelope contract.

export interface PersistenceStatus {
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

function safeStatBytes(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

function getStatus(): PersistenceStatus {
  const dbPath = join(app.getPath('userData'), 'lamprey.db')
  const backupDir = join(app.getPath('userData'), 'backups')
  const backups = listBackups(backupDir)
  return {
    dbPath,
    dbBytes: safeStatBytes(dbPath),
    walBytes: safeStatBytes(`${dbPath}-wal`),
    shmBytes: safeStatBytes(`${dbPath}-shm`),
    lastCheckpoint: getLastCheckpointResult(),
    lastIntegrity: getLastIntegrityResult(),
    backupDir,
    backupCount: backups.length,
    latestBackup: backups[0] ?? null
  }
}

export function registerPersistenceHandlers(): void {
  ipcMain.handle('persistence:getStatus', () => {
    try {
      return { success: true, data: getStatus() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('persistence:runIntegrityCheck', () => {
    try {
      const result = runIntegrityCheck()
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('persistence:forceCheckpoint', () => {
    try {
      const result = checkpoint()
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('persistence:createBackup', async () => {
    try {
      const dbPath = join(app.getPath('userData'), 'lamprey.db')
      const backupDir = join(app.getPath('userData'), 'backups')
      const info = await createBackup(dbPath, backupDir, 'on-demand')
      return { success: true, data: info }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('persistence:listBackups', () => {
    try {
      const backupDir = join(app.getPath('userData'), 'backups')
      return { success: true, data: listBackups(backupDir) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('persistence:restoreFromBackup', async (_event, backupPath: unknown) => {
    if (typeof backupPath !== 'string' || backupPath.length === 0) {
      return { success: false, error: 'backupPath must be a non-empty string' }
    }
    try {
      const dbPath = join(app.getPath('userData'), 'lamprey.db')
      const info = await restoreFromBackup(dbPath, backupPath)
      return { success: true, data: info }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  // PS9 — SQLCipher opt-in encryption surface.
  ipcMain.handle('persistence:getEncryptionStatus', () => {
    try {
      return { success: true, data: getEncryptionStatus() }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('persistence:enableEncryption', (_event, passphrase: unknown) => {
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      return { success: false, error: 'passphrase must be a non-empty string' }
    }
    try {
      const result = enableEncryption(passphrase)
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('persistence:disableEncryption', (_event, passphrase: unknown) => {
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      return { success: false, error: 'passphrase must be a non-empty string' }
    }
    try {
      const result = disableEncryption(passphrase)
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle(
    'persistence:changePassphrase',
    (_event, oldPassphrase: unknown, newPassphrase: unknown) => {
      if (typeof oldPassphrase !== 'string' || typeof newPassphrase !== 'string') {
        return { success: false, error: 'both passphrases must be strings' }
      }
      try {
        changePassphrase(oldPassphrase, newPassphrase)
        return { success: true, data: null }
      } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) }
      }
    }
  )
}
