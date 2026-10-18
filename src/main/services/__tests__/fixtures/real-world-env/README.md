# Real-world environment import fixtures

These fixtures are copied from public, license-compatible sources to validate environment mapping in Bruno, Postman v3, Insomnia, OpenAPI 3, and Swagger 2 imports.

Committed fixtures:

- `bruno-bru-usebruno-secret/` — subset of `usebruno/bruno` (`tests/environments/api-setEnvVar-secret/fixtures/collections/bru`), MIT, source: https://github.com/usebruno/bruno/tree/main/tests/environments/api-setEnvVar-secret/fixtures/collections/bru
- `bruno-yaml-usebruno-secret/` — subset of `usebruno/bruno` (`tests/environments/api-setEnvVar-secret/fixtures/collections/yml`), MIT, source: https://github.com/usebruno/bruno/tree/main/tests/environments/api-setEnvVar-secret/fixtures/collections/yml
- `postman-v3-workslocal/` — subset of `083chandan/workslocal` (`postman/collections/WorksLocal API` + `postman/environments/WorksLocal - Local.environment.yaml`), MIT, source: https://github.com/083chandan/workslocal/tree/main/postman
- `insomnia-v4-kong.json` — `Kong/insomnia` (`packages/insomnia-inso/src/db/fixtures/insomnia-v4/insomnia_v4.json`), Apache-2.0, source: https://github.com/Kong/insomnia/blob/develop/packages/insomnia-inso/src/db/fixtures/insomnia-v4/insomnia_v4.json
- `insomnia-v5-kong-environment-cascade.yaml` — `Kong/insomnia` (`packages/insomnia-smoke-test/fixtures/environment-cascade-collection.yaml`), Apache-2.0, source: https://github.com/Kong/insomnia/blob/develop/packages/insomnia-smoke-test/fixtures/environment-cascade-collection.yaml
- `openapi-oai-uspto.yaml` — `OAI/learn.openapis.org` (`examples/v3.0/uspto.yaml`), CC-BY-4.0, source: https://github.com/OAI/learn.openapis.org/blob/main/examples/v3.0/uspto.yaml
- `swagger-v2-petstore.json` — `petstore.swagger.io` sample export (Swagger Petstore), Apache-2.0 per embedded spec license, source: https://petstore.swagger.io/v2/swagger.json

Swept but not committed:

- `usebruno/bruno` `tests/environments/fixtures/environment-exports/bruno-collection-environments.json` — real Bruno environment-export JSON; imported as a standalone Bruno environment file.
