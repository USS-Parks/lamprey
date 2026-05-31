import { useCallback, useEffect, useRef, useState } from 'react'
import { useThemedIcon } from '@/lib/themed-icon'
import codeWindowLight from '@assets/Lamprey Code Window Icon.png'
import codeWindowDark from '@assets/Lamprey Code Window Icon Dark View.png'

interface ArtifactPanelProps {
  artifactType: string | null
  artifactSource: string | null
  onClose: () => void
}

export function ArtifactPanel({ artifactType, artifactSource, onClose }: ArtifactPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(420)
  const dragging = useRef(false)
  const [copied, setCopied] = useState(false)
  const codeWindowIconUrl = useThemedIcon(codeWindowLight, codeWindowDark)

  const reportBounds = useCallback(() => {
    if (!panelRef.current || !window.api) return
    const rect = panelRef.current.getBoundingClientRect()
    window.api.artifact.resize({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }, [])

  useEffect(() => {
    if (!panelRef.current) return
    const observer = new ResizeObserver(reportBounds)
    observer.observe(panelRef.current)
    reportBounds()
    return () => observer.disconnect()
  }, [reportBounds])

  useEffect(() => {
    reportBounds()
  }, [panelWidth, reportBounds])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startWidth = panelWidth

    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX - me.clientX
      const newWidth = Math.max(280, Math.min(800, startWidth + delta))
      setPanelWidth(newWidth)
    }

    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [panelWidth])

  const handleCopySource = async () => {
    if (artifactSource) {
      await navigator.clipboard.writeText(artifactSource)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenInWindow = () => {
    if (artifactType && artifactSource && window.api) {
      window.api.artifact.openInWindow(artifactType, artifactSource)
    }
  }

  const handleHide = () => {
    window.api?.artifact?.hide()
    onClose()
  }

  return (
    <div
      className="flex flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)]"
      style={{ width: panelWidth }}
    >
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)] transition-colors z-10"
        style={{ position: 'relative', width: 4, minWidth: 4, cursor: 'col-resize' }}
        onMouseDown={handleDragStart}
      />

      <div className="flex flex-1 flex-col" style={{ marginLeft: -4 }}>
        {/* Header */}
        <div className="flex h-12 items-center justify-between px-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <img src={codeWindowIconUrl} alt="" aria-hidden className="icon-asset h-9 w-9 object-contain" />
            <span className="text-sm font-medium text-[var(--text-secondary)]">Artifact</span>
            {artifactType && (
              <span className="rounded bg-[var(--accent-dim)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--accent)]">
                {artifactType}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopySource}
              className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              title="Copy source"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={handleOpenInWindow}
              className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              title="Open in new window"
            >
              Window
            </button>
            <button
              onClick={handleHide}
              className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              title="Close panel"
            >
              X
            </button>
          </div>
        </div>

        {/* BrowserView overlay region */}
        <div ref={panelRef} className="flex-1 bg-[#1a1a2e]" />
      </div>
    </div>
  )
}
