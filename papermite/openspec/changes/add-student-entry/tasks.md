## 1. Extraction Endpoint

- [ ] 1.1 Implement `POST /api/extract/{tenant_id}/{entity_type}` — accept file upload, validate format (PDF, PNG, JPG, JPEG)
- [ ] 1.2 Fetch model definition from datacore to determine expected fields
- [ ] 1.3 Extract field values from uploaded document using existing extraction pipeline
- [ ] 1.4 Return extracted values as JSON mapped to model field names, with partial extraction as success

## 2. Configuration

- [ ] 2.1 Update CORS allowed origins to include `localhost:5174`

## 3. Testing

- [ ] 3.1 Add tests for extraction endpoint — successful extraction, partial extraction, unsupported format, model not found
