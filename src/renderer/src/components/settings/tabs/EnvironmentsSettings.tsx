import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import React, { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useEnvironmentsStore } from '@/store/environments'

export function EnvironmentsSettings() {
  const {
    environments,
    vars,
    load,
    createEnvironment,
    deleteEnvironment,
    setActive,
    upsertVar,
    deleteVar,
  } = useEnvironmentsStore()

  const [newEnvName, setNewEnvName] = React.useState('')
  const [selectedEnvId, setSelectedEnvId] = React.useState<string | null>(null)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!selectedEnvId && environments.length > 0) {
      setSelectedEnvId(environments[0].id)
    }
  }, [environments, selectedEnvId])

  const selectedEnv = environments.find((e) => e.id === selectedEnvId)
  const envVars = vars.filter((v) => v.envId === selectedEnvId)

  const handleCreateEnv = async () => {
    const name = newEnvName.trim()
    if (!name) return
    await createEnvironment(name)
    setNewEnvName('')
  }

  const handleAddVar = () => {
    if (!selectedEnvId) return
    upsertVar(selectedEnvId, '', '', false, crypto.randomUUID())
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-th-text-primary">Environments</h3>

      {/* Environment list */}
      <div className="flex flex-col gap-2">
        {environments.map((env) => (
          <div
            key={env.id}
            className="flex items-center gap-2 rounded border border-th-border px-3 py-2 cursor-pointer hover:border-th-border-strong transition-colors"
            onDoubleClick={() => setActive(env.id)}
            title={env.isActive ? 'Active environment' : 'Click to select · Double-click to activate'}
          >
            <input
              type="radio"
              checked={env.isActive}
              onChange={() => setActive(env.id)}
              className="accent-blue-500"
            />
            <button
              onClick={() => setSelectedEnvId(env.id)}
              className={`flex-1 text-left text-sm ${selectedEnvId === env.id ? 'text-th-text-primary' : 'text-th-text-muted hover:text-th-text-primary'}`}
            >
              {env.name}
              {env.isActive && <span className="ml-2 text-xs text-emerald-400">active</span>}
            </button>
            <button
              onClick={() => deleteEnvironment(env.id)}
              className="text-th-text-faint hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <div className="flex gap-2">
          <Input
            placeholder="New environment name..."
            value={newEnvName}
            onChange={(e) => setNewEnvName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateEnv()}
          />
          <Button size="sm" variant="outline" onClick={handleCreateEnv}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Variables for selected env */}
      {selectedEnv && (
        <div>
          <div className="mb-2 text-xs font-medium text-th-text-muted">
            Variables — {selectedEnv.name}
          </div>

          <div className="flex flex-col gap-1">
            {envVars.length > 0 && (
              <div className="mb-1 grid grid-cols-[1fr_1fr_32px_28px] gap-1 px-1 text-xs text-th-text-faint">
                <span>Key</span>
                <span>Value</span>
                <span>Secret</span>
                <span />
              </div>
            )}

            {envVars.map((v) => (
              <div key={v.id} className="grid grid-cols-[1fr_1fr_32px_28px] items-center gap-1">
                <Input
                  value={v.key}
                  onChange={(e) => upsertVar(v.envId, e.target.value, v.value, v.isSecret, v.id)}
                  placeholder="KEY"
                />
                <Input
                  type={v.isSecret ? 'password' : 'text'}
                  value={v.value}
                  onChange={(e) => upsertVar(v.envId, v.key, e.target.value, v.isSecret, v.id)}
                  placeholder="value"
                />
                <button
                  onClick={() => upsertVar(v.envId, v.key, v.value, !v.isSecret, v.id)}
                  className={`flex h-8 w-8 items-center justify-center rounded hover:bg-th-surface-raised focus:outline-none ${v.isSecret ? 'text-amber-400' : 'text-th-text-faint'}`}
                  title={v.isSecret ? 'Secret (click to reveal)' : 'Not secret'}
                >
                  {v.isSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => deleteVar(v.id)}
                  className="flex h-8 w-7 items-center justify-center rounded text-th-text-faint hover:bg-th-surface-raised hover:text-rose-400 focus:outline-none"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <Button variant="ghost" size="sm" className="mt-1 w-fit gap-1.5 text-th-text-muted" onClick={handleAddVar}>
              <Plus className="h-3.5 w-3.5" /> Add variable
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
