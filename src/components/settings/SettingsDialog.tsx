import { useState } from 'react'
import { McpSettings } from './McpSettings'
import { GeneralSettings } from './GeneralSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { ModelSettings } from './ModelSettings'
import { ApiKeySettings } from './ApiKeySettings'
import { AgentSettings } from './AgentSettings'
import { AgenticCodingSettings } from './AgenticCodingSettings'
import { HooksSettings } from './HooksSettings'
import { AutomationsSettings } from './AutomationsSettings'
import { WebToolsSettings } from './WebToolsSettings'
import { CurrentInfoSettings } from './CurrentInfoSettings'
import { ImageGenSettings } from './ImageGenSettings'
import { PermissionsSettings } from './PermissionsSettings'
import { PlanGoalSettings } from './PlanGoalSettings'
import { GitHubSettings } from './GitHubSettings'
import { ActivityTimeline } from '@/components/activity/ActivityTimeline'
import { LibraryView } from '@/components/library/LibraryView'
import { RagSettings } from './RagSettings'
import { useUiStore } from '@/stores/ui-store'

interface SettingsDialogProps {
  onClose: () => void
}

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Models' },
  { id: 'agents', label: 'Agents' },
  { id: 'agenticCoding', label: 'Coding Mode' },
  { id: 'api', label: 'API Keys' },
  { id: 'github', label: 'GitHub' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'webTools', label: 'Web Tools' },
  { id: 'currentInfo', label: 'Current Info' },
  { id: 'imageGen', label: 'Image Gen' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'planGoal', label: 'Plans & Goals' },
  { id: 'hooks', label: 'Hooks' },
  { id: 'automations', label: 'Automations' },
  { id: 'library', label: 'Library' },
  { id: 'rag', label: 'RAG' },
  { id: 'activity', label: 'Activity' }
] as const

type TabId = (typeof TABS)[number]['id']

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const initialTab = useUiStore((s) => s.settingsInitialTab)
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? 'general')

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="flex h-[560px] w-[720px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl">
        {/* Sidebar tabs */}
        <div className="flex w-40 flex-col border-r border-[var(--border)] bg-[var(--bg-primary)] py-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-left font-mono text-xs transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col">
          <div className="flex h-10 items-center justify-between border-b border-[var(--border)] px-4">
            <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">Settings</span>
            <button
              onClick={onClose}
              className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'general' && <GeneralSettings />}
            {activeTab === 'models' && <ModelSettings />}
            {activeTab === 'agents' && <AgentSettings />}
            {activeTab === 'agenticCoding' && <AgenticCodingSettings />}
            {activeTab === 'api' && <ApiKeySettings />}
            {activeTab === 'github' && <GitHubSettings />}
            {activeTab === 'appearance' && <AppearanceSettings />}
            {activeTab === 'mcp' && <McpSettings />}
            {activeTab === 'webTools' && <WebToolsSettings />}
            {activeTab === 'currentInfo' && <CurrentInfoSettings />}
            {activeTab === 'imageGen' && <ImageGenSettings />}
            {activeTab === 'permissions' && <PermissionsSettings />}
            {activeTab === 'planGoal' && <PlanGoalSettings />}
            {activeTab === 'hooks' && <HooksSettings />}
            {activeTab === 'automations' && <AutomationsSettings />}
            {activeTab === 'library' && <LibraryView />}
            {activeTab === 'rag' && <RagSettings />}
            {activeTab === 'activity' && <ActivityTimeline />}
          </div>
        </div>
      </div>
    </div>
  )
}
