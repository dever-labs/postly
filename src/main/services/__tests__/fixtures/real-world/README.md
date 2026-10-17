# Real-world import fixtures

These fixtures are copied from public repositories to validate the Postman v3 Native Git and Bruno OpenCollection importers against non-spec-derived files.

Committed fixtures:

- `postman-v3-executor-mcp/` — subset of `qdrddr/clear-your-tools` (`postman/collections/executor-mcp/11 - Plugin GraphQL` + root definition), Apache-2.0, source: https://github.com/qdrddr/clear-your-tools/tree/main/postman/collections/executor-mcp
- `postman-v3-workslocal/` — subset of `083chandan/workslocal` (`postman/collections/WorksLocal API/API Keys` + root definition), MIT, source: https://github.com/083chandan/workslocal/tree/main/postman/collections/WorksLocal%20API
- `bruno-yaml-usebruno-typed/` — subset of `usebruno/bruno` (`packages/bruno-tests/yml-collection`), MIT, source: https://github.com/usebruno/bruno/tree/main/packages/bruno-tests/yml-collection
- `bruno-yaml-usebruno-ntlm/` — subset of `usebruno/bruno` (`tests/auth/ntlm/fixtures/collections/ntlm`), MIT. Credential-like values were scrubbed. Source: https://github.com/usebruno/bruno/tree/main/tests/auth/ntlm/fixtures/collections/ntlm
- `bruno-yaml-kimun/` — subset of `nico2sh/kimun` (`server/bruno`), MIT, source: https://github.com/nico2sh/kimun/tree/main/server/bruno

Swept but not committed:

- `ghostbyte-dev/pixelix` (`api-docs-bruno/vernissage`), GPL-3.0, source: https://github.com/ghostbyte-dev/pixelix/tree/main/api-docs-bruno/vernissage
- `opencollection-dev/opencollection` was checked for example collections, but the repository currently exposes schema/converter sources rather than reusable collection files.
