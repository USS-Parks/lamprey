import { useState } from 'react'
import { useUiStore, type CustomizeColumnId } from '@/stores/ui-store'
import { SkillsColumn } from './SkillsColumn'
import { ConnectorsColumn } from './ConnectorsColumn'
import { PluginsColumn } from './PluginsColumn'
import { NewSkillWizard } from './NewSkillWizard'
import { AddConnectorFlow } from './AddConnectorFlow'
import { InstallPluginFlow } from './InstallPluginFlow'

interface ColumnDef {
  id: CustomizeColumnId
  label: string
  description: string
}

const COLUMNS: ColumnDef[] = [
  { id: 'skills', label: 'Skills', description: 'Your authored Markdown skills' },
  { id: 'connectors', label: 'Connectors', description: 'MCP servers Lamprey can call' },
  { id: 'plugins', label: 'Plugins', description: 'Bundled skill + connector packs' }
]

interface CtaCardProps {
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
}

function CtaCard({ title, description, onClick, disabled }: CtaCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group flex w-full items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)]'
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</div>
        <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{description}</div>
      </div>
    </button>
  )
}

export function CustomizeView() {
  const closeCustomize = useUiStore((s) => s.closeCustomize)
  const initialColumn = useUiStore((s) => s.customizeInitialColumn)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [addConnectorOpen, setAddConnectorOpen] = useState(false)
  const [installPluginOpen, setInstallPluginOpen] = useState(false)

  // Highlighting only — every column renders all the time so the panel
  // shows the full surface at a glance, matching the Claude Code layout.
  const focusColumn: CustomizeColumnId = initialColumn ?? 'skills'

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[var(--bg-primary)]">
      {/* Breadcrumb / close row */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-4">
        <button
          onClick={closeCustomize}
          aria-label="Back to chat"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[14px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Customize</span>
        </button>
        <div className="flex-1" />
        <button
          onClick={closeCustomize}
          aria-label="Close"
          className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Page heading */}
      <div className="shrink-0 px-6 pt-6">
        <h1 className="font-serif text-[28px] font-semibold tracking-tight text-[var(--text-primary)]">
          Customize Lamprey
        </h1>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
          Skills, connectors, and plugins shape how Lamprey works with you.
        </p>
        <div className="mt-3 rounded-md border border-[var(--accent-dim)] bg-[var(--accent-dim)]/10 px-3 py-1.5 text-[12px] text-[var(--text-secondary)]">
          New here? Try{' '}
          <button
            onClick={() => setWizardOpen(true)}
            className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Create new skills
          </button>{' '}
          to scaffold your first skill in three steps, or browse the bundled plugins below.
        </div>
      </div>

      {/* Three-column body */}
      <div className="flex min-h-0 flex-1 gap-4 px-6 py-6">
        {COLUMNS.map((col) => (
          <section
            key={col.id}
            aria-label={col.label}
            className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-[var(--bg-secondary)] ${
              focusColumn === col.id ? 'border-[var(--accent)]' : 'border-[var(--border)]'
            }`}
          >
            <header className="shrink-0 border-b border-[var(--border)] px-4 py-3">
              <div className="text-[15px] font-semibold text-[var(--text-primary)]">
                {col.label}
              </div>
              <div className="text-[12px] text-[var(--text-secondary)]">{col.description}</div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {col.id === 'skills' && <SkillsColumn />}
              {col.id === 'connectors' && <ConnectorsColumn />}
              {col.id === 'plugins' && <PluginsColumn />}
            </div>
          </section>
        ))}
      </div>

      {/* CTA cards. Wired live in C4/C6/C10; inert this prompt. */}
      <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-secondary)] px-6 py-4">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3">
          <CtaCard
            title="Connect your apps"
            description="Add an MCP server to extend tool reach."
            onClick={() => setAddConnectorOpen(true)}
          />
          <CtaCard
            title="Create new skills"
            description="Scaffold a Markdown skill in a guided flow."
            onClick={() => setWizardOpen(true)}
          />
          <CtaCard
            title="Browse plugins"
            description="Discover and install bundled plugin packs."
            onClick={() => setInstallPluginOpen(true)}
          />
        </div>
      </div>

      {wizardOpen && <NewSkillWizard onClose={() => setWizardOpen(false)} />}
      {addConnectorOpen && <AddConnectorFlow onClose={() => setAddConnectorOpen(false)} />}
      {installPluginOpen && <InstallPluginFlow onClose={() => setInstallPluginOpen(false)} />}
    </div>
  )
}
