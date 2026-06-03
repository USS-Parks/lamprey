import { useRef, useState } from 'react'
import { useRagStore } from '@/stores/rag-store'

interface IngestDropzoneProps {
  collectionId: string
}

export function IngestDropzone({ collectionId }: IngestDropzoneProps) {
  const submitIngest = useRagStore((s) => s.submitIngest)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // The renderer cannot read file contents directly — `path` is only
  // available via electron's File.path extension. Drag-drop in Electron
  // gives us `File` objects with a `.path` property when allowed by the
  // contextBridge. The webUtils.getPathForFile() preload helper is the
  // cleaner accessor (added in Electron 32); fall back to (File as any).path
  // for older builds. Both code paths produce absolute paths.
  const collectPaths = (files: FileList | null): string[] => {
    if (!files) return []
    const out: string[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as File & { path?: string }
      const getPath = (window as { api?: { app?: { getPathForFile?: (f: File) => string } } })
        .api?.app?.getPathForFile
      const p = getPath ? getPath(f) : f.path
      if (typeof p === 'string' && p) out.push(p)
    }
    return out
  }

  const submitPaths = (paths: string[]): void => {
    if (paths.length === 0) return
    void submitIngest(
      collectionId,
      paths.map((p) => {
        const name = p.split(/[\\/]/).pop() ?? p
        return { path: p, name }
      })
    )
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        submitPaths(collectPaths(e.dataTransfer.files))
      }}
      className={`flex items-center justify-between rounded border border-dashed px-3 py-2 ${
        dragOver
          ? 'border-[var(--text-primary)] bg-[var(--bg-tertiary)]'
          : 'border-[var(--border)]'
      }`}
    >
      <div className="flex flex-col">
        <span className="font-mono text-[12px] text-[var(--text-primary)]">
          Drop files here
        </span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          .md .txt .pdf .docx + source code
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          submitPaths(collectPaths(e.target.files))
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="rounded border border-[var(--border)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
      >
        Browse
      </button>
    </div>
  )
}
