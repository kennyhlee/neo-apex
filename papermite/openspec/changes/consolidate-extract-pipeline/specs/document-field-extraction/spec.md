## MODIFIED Requirements

### Requirement: POST document extraction endpoint
Papermite SHALL expose `POST /api/extract/{tenant_id}/{entity_type}` to accept a file upload and return extracted field values. The endpoint SHALL invoke the shared `extraction_pipeline.extract_for_entity` to perform parsing and extraction, and SHALL therefore honor `PAPERMITE_PARSER_BACKEND` for backend selection.

#### Scenario: Successful full extraction
- **WHEN** a supported file is uploaded and the extraction pipeline extracts all model fields
- **THEN** the API returns HTTP 200 with a JSON object mapping field names to extracted values

#### Scenario: Partial extraction
- **WHEN** a supported file is uploaded but the extraction pipeline can only extract some fields
- **THEN** the API returns HTTP 200 with only the successfully extracted fields — missing fields are absent from the response

#### Scenario: Unsupported file format
- **WHEN** a file is uploaded with an unsupported format (not PDF, DOCX, or TXT)
- **THEN** the API returns HTTP 422 with an error message naming the supported formats

#### Scenario: Extraction pipeline failure
- **WHEN** the extraction pipeline encounters an unrecoverable error
- **THEN** the API returns HTTP 500 with an error message

#### Scenario: Vision backend used when configured
- **WHEN** a PDF is uploaded and `PAPERMITE_PARSER_BACKEND=claude_merged` is set
- **THEN** the endpoint extracts fields by sending the PDF directly to a vision-capable LLM and does not load the docling pipeline

#### Scenario: Local backend used when configured
- **WHEN** a PDF is uploaded and `PAPERMITE_PARSER_BACKEND=local` is set (or the setting is absent)
- **THEN** the endpoint extracts fields by parsing with docling and then prompting an LLM with the parsed text

### Requirement: Model-aware extraction
The extraction endpoint SHALL fetch the entity model definition from datacore to determine which fields to extract from the document, and SHALL pass that definition to the pipeline so that extraction is scoped to the requested entity type.

#### Scenario: Model definition guides extraction
- **WHEN** a document is uploaded for a given tenant and entity type
- **THEN** the endpoint fetches the active model definition from datacore and passes the entity's field list to the pipeline as targeted prompt context

#### Scenario: Model not found
- **WHEN** no active model definition exists for the given tenant and entity type
- **THEN** the API returns HTTP 404 with an error message indicating the model must be configured first

#### Scenario: Returned fields filtered to model definition
- **WHEN** the extractor produces field names that are not in the model definition for the requested entity type
- **THEN** those fields are excluded from the response (the pipeline performs this filtering, not the route)

### Requirement: CORS updated for admindash
Papermite SHALL allow CORS requests from the admindash frontend origin (`http://localhost:5174`).

#### Scenario: Cross-origin request from admindash
- **WHEN** the admindash frontend makes a request to the papermite API
- **THEN** the response includes appropriate CORS headers allowing the request
