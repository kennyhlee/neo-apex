import { describe, it, expect } from "vitest";
import { mergeExtractionResults } from "./client";
import type { ExtractionResult, EntityResult } from "../types/models";

function result(entities: EntityResult[]): ExtractionResult {
  return {
    extraction_id: "edit-1",
    tenant_id: "t1",
    filename: "base",
    entities,
    status: "pending_review",
  };
}

describe("mergeExtractionResults (append additional documents, #53)", () => {
  it("adds newly-discovered fields from the incoming extraction", () => {
    const base = result([
      {
        entity_type: "STUDENT",
        entity: { first_name: "" },
        field_mappings: [
          { field_name: "first_name", value: "", source: "base_model", required: true, field_type: "str" },
        ],
      },
    ]);
    const incoming = result([
      {
        entity_type: "STUDENT",
        entity: { allergies: "peanuts" },
        field_mappings: [
          { field_name: "allergies", value: "peanuts", source: "custom_field", required: false, field_type: "str" },
        ],
      },
    ]);

    const merged = mergeExtractionResults(base, incoming);
    const student = merged.entities.find((e) => e.entity_type === "STUDENT")!;
    const names = student.field_mappings.map((m) => m.field_name);
    expect(names).toContain("first_name");
    expect(names).toContain("allergies");
    expect(student.entity.allergies).toBe("peanuts");
  });

  it("keeps the base field definition and does not duplicate existing fields", () => {
    const base = result([
      {
        entity_type: "STUDENT",
        entity: {},
        field_mappings: [
          { field_name: "status", value: "", source: "base_model", required: true, field_type: "selection", options: ["active"], default: "active" },
        ],
      },
    ]);
    const incoming = result([
      {
        entity_type: "STUDENT",
        entity: {},
        field_mappings: [
          { field_name: "status", value: "inactive", source: "custom_field", required: false, field_type: "selection", options: ["inactive"] },
        ],
      },
    ]);

    const merged = mergeExtractionResults(base, incoming);
    const student = merged.entities.find((e) => e.entity_type === "STUDENT")!;
    const statusFields = student.field_mappings.filter((m) => m.field_name === "status");
    expect(statusFields).toHaveLength(1);
    // Base definition wins (required, default) but options are unioned.
    expect(statusFields[0].required).toBe(true);
    expect(statusFields[0].default).toBe("active");
    expect(statusFields[0].options).toEqual(["active", "inactive"]);
  });

  it("adds an entity type present only in the incoming extraction", () => {
    const base = result([
      { entity_type: "STUDENT", entity: {}, field_mappings: [] },
    ]);
    const incoming = result([
      {
        entity_type: "PROGRAM",
        entity: { name: "Chess Club" },
        field_mappings: [
          { field_name: "name", value: "Chess Club", source: "base_model", required: true, field_type: "str" },
        ],
      },
    ]);

    const merged = mergeExtractionResults(base, incoming);
    expect(merged.entities.map((e) => e.entity_type).sort()).toEqual(["PROGRAM", "STUDENT"]);
  });
});
