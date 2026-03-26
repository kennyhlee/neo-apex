## Why

Storage in NeoApex is currently embedded inside papermite (`lance_store.py`), tightly coupled to its extraction models. Other projects (admindash, enrollx, familyhub) will need persistent vector storage too. Without a shared storage layer, each project would duplicate LanceDB setup, versioning logic, and query patterns.

## What Changes

- Stand up **datacore** as an installable Python package wrapping LanceDB
- Provide a general-purpose, tenant-scoped CRUD API with built-in versioning
- Add a **DuckDB + Apache Arrow** SQL query layer for analytical access to stored data
- Make datacore a pip-installable dependency for other NeoApex projects

## Capabilities

### New Capabilities
- `vector-store`: General-purpose LanceDB abstraction with tenant-scoped CRUD, version history, and `change_id` for grouped rollback
- `sql-query`: DuckDB + Arrow integration to query LanceDB tables using SQL
- `package`: Installable Python package (`datacore`) with clean public API

### Modified Capabilities
_None — this is a greenfield package in an empty project_

## Impact

- `datacore/` — new Python package (pyproject.toml, src layout, modules)
- `papermite/` — no changes in this change (follow-up: refactor `lance_store.py` to use datacore)
