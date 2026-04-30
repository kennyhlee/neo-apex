## ADDED Requirements

Note: All entity API client functions in `client.ts` have been consolidated into generic functions (`createEntity`, `updateEntity`, `fetchNextEntityId`, `archiveEntities`). Programs use these with `entityType = 'program'`. No new API client functions are needed.

### Requirement: Generic entity CRUD functions support programs
The existing generic API client functions (`createEntity`, `updateEntity`, `fetchNextEntityId`, `archiveEntities`) SHALL work for program entities by passing `'program'` as the `entityType` parameter.

#### Scenario: Create program via createEntity
- **WHEN** `createEntity(tenantId, 'program', baseData, customFields)` is called
- **THEN** it SHALL POST to `POST /api/entities/{tenantId}/program` and return the created entity

#### Scenario: Update program via updateEntity
- **WHEN** `updateEntity(tenantId, 'program', entityId, baseData, customFields)` is called
- **THEN** it SHALL PUT to `PUT /api/entities/{tenantId}/program/{entityId}` and return the updated entity

#### Scenario: Fetch next program ID via fetchNextEntityId
- **WHEN** `fetchNextEntityId(tenantId, 'program')` is called
- **THEN** it SHALL GET from `/api/entities/{tenantId}/program/next-id` and return the next auto-generated program ID (format: `{abbrev}-PR{yy}{seq}`)

#### Scenario: Archive programs via archiveEntities
- **WHEN** `archiveEntities(tenantId, 'program', entityIds)` is called
- **THEN** it SHALL POST to `/api/entities/{tenantId}/program/archive` and return the archived count

### Requirement: DataCore program abbreviation registered
DataCore's `DEFAULT_ABBREVS` SHALL include `"program": "PR"` so that auto-ID generation works for program entities.

#### Scenario: Program ID format
- **WHEN** a program is created with auto-ID
- **THEN** the ID SHALL follow the format `{tenant_abbrev}-PR{yy}{seq:04d}` (e.g., `ACC-PR260001`)
