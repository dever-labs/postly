import { test, expect } from './fixtures'

const stamp = Date.now()
const collectionName = `Postly Env Import ${stamp}`
const environmentNames = [`Env QA ${stamp}`, `Env Prod ${stamp}`]

const postlyExport = {
  $schema: 'postly/v1',
  exportedAt: new Date().toISOString(),
  collections: [
    {
      name: collectionName,
      description: 'Imported with environments',
      source: 'local',
      auth: { type: 'none', config: {} },
      ssl: 'inherit',
      requests: [
        {
          name: `Health ${stamp}`,
          method: 'GET',
          url: 'https://api.example.test/health',
          protocol: 'http',
          params: [],
          headers: [],
          bodyType: 'none',
          bodyContent: '',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          description: '',
          protocolConfig: {},
        },
      ],
      folders: [],
      environments: [
        {
          name: environmentNames[0],
          variables: [
            { key: 'base_url', value: 'https://qa.example.test', isSecret: false },
            { key: 'api_key', value: 'qa-secret', isSecret: true },
          ],
        },
        {
          name: environmentNames[1],
          variables: [
            { key: 'base_url', value: 'https://prod.example.test', isSecret: false },
          ],
        },
      ],
    },
  ],
}

test.afterAll(async ({ window }) => {
  await window.evaluate(async ([rootName, envs]: [string, string[]]) => {
    const folders = await window.api.folders.list() as {
      data?: Array<{ id: string; name: string; parentId?: string | null; parent_id?: string | null }>
    }
    for (const folder of folders.data ?? []) {
      if (!(folder.parentId ?? folder.parent_id) && folder.name === rootName) {
        await window.api.folders.delete({ id: folder.id })
      }
    }

    const result = await window.api.environments.list() as {
      data?: {
        environments?: Array<{ id: string; name: string }>
      }
    }
    for (const environment of result.data?.environments ?? []) {
      if (envs.includes(environment.name)) {
        await window.api.environments.delete({ id: environment.id })
      }
    }
  }, [collectionName, environmentNames] as [string, string[]])
})

test.describe('Import environments', () => {
  test('imports environments and persists their variables through the Postly import flow', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    await window.locator('input[type="file"]:not([data-testid="import-folder-input"])').setInputFiles({
      name: 'environments.postly.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(postlyExport)),
    })

    await expect(window.getByTestId('import-format')).toContainText('Postly export')
    await expect(window.getByText('0 folders · 1 request · 2 environments')).toBeVisible()

    await window.getByRole('button', { name: /Import 1 collection/ }).click()
    await expect(window.getByRole('treeitem', { name: new RegExp(`^${collectionName}`) })).toBeVisible()

    const environments = await window.evaluate(async (names: string[]) => {
      const result = await window.api.environments.list() as {
        data?: {
          environments?: Array<{ id: string; name: string; isActive?: boolean; is_active?: number }>
          vars?: Array<{ envId?: string; env_id?: string; key: string; value: string; isSecret?: boolean; is_secret?: number }>
        }
      }

      const envs = result.data?.environments ?? []
      const vars = result.data?.vars ?? []

      return names.map((name) => {
        const env = envs.find((entry) => entry.name === name)
        return {
          name,
          exists: Boolean(env),
          isActive: Boolean(env?.isActive ?? env?.is_active ?? false),
          vars: vars
            .filter((variable) => (variable.envId ?? variable.env_id) === env?.id)
            .map((variable) => ({
              key: variable.key,
              value: variable.value,
              isSecret: Boolean(variable.isSecret ?? variable.is_secret ?? false),
            }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        }
      })
    }, environmentNames)

    expect(environments).toEqual([
      {
        name: environmentNames[0],
        exists: true,
        isActive: false,
        vars: [
          { key: 'api_key', value: 'qa-secret', isSecret: true },
          { key: 'base_url', value: 'https://qa.example.test', isSecret: false },
        ],
      },
      {
        name: environmentNames[1],
        exists: true,
        isActive: false,
        vars: [
          { key: 'base_url', value: 'https://prod.example.test', isSecret: false },
        ],
      },
    ])
  })
})
