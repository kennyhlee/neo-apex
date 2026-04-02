# Spec: Document Field Extraction

## Purpose

Expose an API endpoint that accepts a document upload for a given tenant and entity type, uses the active model definition to guide extraction, and returns a structured map of extracted field values. Supports admindash cross-origin access.

## Requirements

### Requirement: POST document extraction endpoint
Papermite SHALL expose `POST /api/extract/{tenant_id}/{entity_type}` to accept a file upload and return extracted field values.

#### Scenario: Successful full extraction
- **WHEN** a supported file is uploaded and the extraction pipeline extracts all model fields
- **THEN** the API returns HTTP 200 with a JSON object mapping field names to extracted values

#### Scenario: Partial extraction
- **WHEN** a supported file is uploaded but the extraction pipeline can only extract some fields
- **THEN** the API returns HTTP 200 with only the successfully extracted fields — missing fields are absent from the response

#### Scenario: Unsupported file format
- **WHEN** a file is uploaded with an unsupported format (not PDF, PNG, JPG, or JPEG)
- **THEN** the API returns HTTP 422 with an error message

#### Scenario: Extraction pipeline failure
- **WHEN** the extraction pipeline encounters an unrecoverable error
- **THEN** the API returns HTTP 500 with an error message

### Requirement: Model-aware extraction
The extraction endpoint SHALL fetch the entity model definition from datacore to determine which fields to extract from the document.

#### Scenario: Model definition guides extraction
- **WHEN** a document is uploaded for a given tenant and entity type
- **THEN** the endpoint fetches the active model definition from datacore and uses its field names and types to guide extraction

#### Scenario: Model not found
- **WHEN** no active model definition exists for the given tenant and entity type
- **THEN** the API returns HTTP 404 with an error message indicating the model must be configured first

### Requirement: CORS updated for admindash
Papermite SHALL allow CORS requests from the admindash frontend origin (`http://localhost:5174`).

#### Scenario: Cross-origin request from admindash
- **WHEN** the admindash frontend makes a request to the papermite API
- **THEN** the response includes appropriate CORS headers allowing the request
