import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronDown, ChevronRight, Database, Eye, EyeOff, FolderOpen, GitBranch, GitFork } from 'lucide-react'
import React, { useState } from 'react'
import type { Collection, CollectionSource, Group, Request } from '@/types'
import { RequestTreeItem } from '@/components/sidebar/RequestTreeItem'
import { Badge } from '@/components/ui/Badge'
import { useCollectionsStore } from '@/store/collections'
import { useRequestsStore } from '@/store/requests'
import { cn } from '@/lib/utils'

const SOURCE_ICONS: Record<CollectionSource, React.ReactNode> = {
  local: <FolderOpen className="h-3.5 w-3.5" />,
  backstage: <Database className="h-3.5 w-3.5" />,
  github: <GitFork className="h-3.5 w-3.5" />,
  gitlab: <GitBranch className="h-3.5 w-3.5" />,
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

interface GroupSectionProps {
  source: CollectionSource
  collections: Collection[]
  groups: Group[]
  requests: Request[]
  searchQuery: string
}

export function GroupSection({ source, collections, groups, requests, searchQuery }: GroupSectionProps) {
  const [sourceOpen, setSourceOpen] = useState(true)
  const { toggleGroupCollapsed, toggleSourceHidden, hiddenSources, deleteRequest } = useCollectionsStore()
  const { activeRequestId, setActiveRequest } = useRequestsStore()

  const sourceCollections = collections.filter((c) => c.source === source)
  const isSourceHidden = hiddenSources.has(source)

  const totalRequests = requests.filter((r) => {
    const group = groups.find((g) => g.id === r.groupId)
    return group && sourceCollections.some((c) => c.id === group.collectionId)
  })

  const filteredRequests = (groupId: string) => {
    const q = searchQuery.toLowerCase()
    return requests.filter(
      (r) =>
        r.groupId === groupId &&
        (!q || r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q))
    )
  }

  return (
    <Collapsible.Root open={sourceOpen} onOpenChange={setSourceOpen} className="mb-1">
      <div className="flex items-center gap-1 px-2 py-1">
        <Collapsible.Trigger asChild>
          <button className="flex flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 focus:outline-none">
            {sourceOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {SOURCE_ICONS[source]}
            <span>{capitalize(source)}</span>
            <Badge variant="grey" className="ml-1">{totalRequests.length}</Badge>
          </button>
        </Collapsible.Trigger>
        <button
          onClick={() => toggleSourceHidden(source)}
          className="rounded p-0.5 text-neutral-600 hover:text-neutral-400 focus:outline-none"
          title={isSourceHidden ? 'Show source' : 'Hide source'}
        >
          {isSourceHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
      </div>

      <Collapsible.Content>
        <div className={cn(isSourceHidden && 'opacity-40')}>
          {sourceCollections.map((collection) => {
            const collectionGroups = groups.filter((g) => g.collectionId === collection.id)

            return (
              <div key={collection.id} className="mb-1">
                <div className="px-3 py-1 text-xs font-medium text-neutral-500">{collection.name}</div>

                {collectionGroups.map((group) => {
                  const groupRequests = filteredRequests(group.id)

                  return (
                    <Collapsible.Root
                      key={group.id}
                      open={!group.collapsed}
                      onOpenChange={() => toggleGroupCollapsed(group.id)}
                    >
                      <Collapsible.Trigger asChild>
                        <button
                          className={cn(
                            'flex w-full items-center gap-1.5 px-4 py-1 text-xs text-neutral-400 hover:text-neutral-200 focus:outline-none',
                            group.hidden && 'opacity-50'
                          )}
                        >
                          {group.collapsed ? (
                            <ChevronRight className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                          <span className="truncate">{group.name}</span>
                          {group.hidden && <EyeOff className="ml-auto h-3 w-3" />}
                        </button>
                      </Collapsible.Trigger>

                      <Collapsible.Content>
                        <div className="pl-2">
                          {groupRequests.map((req) => (
                            <RequestTreeItem
                              key={req.id}
                              request={req}
                              isActive={req.id === activeRequestId}
                              onClick={() => setActiveRequest(req)}
                              onDelete={() => deleteRequest(req.id)}
                            />
                          ))}
                        </div>
                      </Collapsible.Content>
                    </Collapsible.Root>
                  )
                })}
              </div>
            )
          })}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
