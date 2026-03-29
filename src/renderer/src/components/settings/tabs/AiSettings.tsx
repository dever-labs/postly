import React, { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useSettingsStore } from '@/store/settings'

const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
const ANTHROPIC_MODELS = ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229']

export function AiSettings() {
  const aiSettings = useSettingsStore((s) => s.ai)
  const save = useSettingsStore((s) => s.save)
  const [provider, setProvider] = useState<string>(aiSettings?.provider ?? 'openai')
  const [apiKey, setApiKey] = useState<string>(aiSettings?.apiKey ?? '')
  const [model, setModel] = useState<string>(aiSettings?.model ?? '')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (aiSettings) {
      setProvider(aiSettings.provider ?? 'openai')
      setApiKey(aiSettings.apiKey ?? '')
      setModel(aiSettings.model ?? '')
    }
  }, [aiSettings])

  const handleSave = async () => {
    await save('ai', { provider, apiKey, model })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const models = provider === 'openai' ? OPENAI_MODELS : ANTHROPIC_MODELS
  const defaultModel = provider === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-20241022'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-th-text-primary mb-1">AI Integration</h2>
        <p className="text-sm text-th-text-muted">Configure an AI provider to help design and generate API endpoints.</p>
      </div>

      {/* Provider */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-th-text-secondary">Provider</label>
        <div className="flex gap-2">
          {(['openai', 'anthropic'] as const).map((p) => (
            <button
              key={p}
              onClick={() => { setProvider(p); setModel('') }}
              className={`flex-1 rounded-md border px-4 py-2 text-sm transition-colors focus:outline-none ${
                provider === p
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-th-border text-th-text-muted hover:border-th-border-strong hover:text-th-text-primary'
              }`}
            >
              {p === 'openai' ? 'OpenAI' : 'Anthropic'}
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-th-text-secondary">
          API Key <span className="text-th-text-faint font-normal">({provider === 'openai' ? 'sk-...' : 'sk-ant-...'})</span>
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`Enter your ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key`}
            className="w-full rounded-md border border-th-border bg-th-surface px-3 py-2 pr-10 text-sm text-th-text-primary placeholder:text-th-text-faint focus:border-th-border-strong focus:outline-none"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-th-text-subtle hover:text-th-text-secondary focus:outline-none"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-th-text-faint">Stored locally. Never sent to anyone other than the selected AI provider.</p>
      </div>

      {/* Model */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-th-text-secondary">Model <span className="text-th-text-faint font-normal">(optional — leave blank for default)</span></label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-md border border-th-border bg-th-surface px-3 py-2 text-sm text-th-text-primary focus:border-th-border-strong focus:outline-none"
        >
          <option value="">Default ({defaultModel})</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <button
        onClick={handleSave}
        className={`self-start rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none ${
          saved
            ? 'bg-emerald-600 text-white'
            : 'bg-blue-600 text-white hover:bg-blue-500'
        }`}
      >
        {saved ? '✓ Saved' : 'Save'}
      </button>
    </div>
  )
}
