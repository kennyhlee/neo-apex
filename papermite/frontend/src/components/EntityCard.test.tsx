import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EntityCard from "./EntityCard";
import type { EntityResult } from "../types/models";

function makeEntity(): EntityResult {
  return {
    entity_type: "STUDENT",
    entity: { grade_level: "9", subjects: ["math"] },
    field_mappings: [
      {
        field_name: "grade_level",
        value: "9",
        source: "custom_field",
        required: false,
        field_type: "str",
        default: "9",
      },
      {
        field_name: "subjects",
        value: ["math"],
        source: "custom_field",
        required: false,
        field_type: "selection",
        options: ["math", "science"],
        multiple: true,
        default: ["math"],
      },
    ],
  };
}

describe("EntityCard", () => {
  it("renders a Default column header between Value and Data Type", () => {
    const entity = makeEntity();
    render(<EntityCard entity={entity} index={0} onUpdate={() => {}} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim() ?? "");
    const valueIdx = headers.indexOf("Value");
    const defaultIdx = headers.indexOf("Default");
    const dataTypeIdx = headers.indexOf("Data Type");
    expect(valueIdx).toBeGreaterThanOrEqual(0);
    expect(defaultIdx).toBe(valueIdx + 1);
    expect(dataTypeIdx).toBe(defaultIdx + 1);
  });

  it("clears default when a field's type changes", () => {
    const entity = makeEntity();
    let latest: EntityResult | null = null;
    render(
      <EntityCard
        entity={entity}
        index={0}
        onUpdate={(_, updated) => {
          latest = updated;
        }}
      />
    );
    const typeSelects = screen.getAllByRole("combobox").filter(
      (el) => el.classList.contains("field-row__type-select")
    );
    const gradeLevelType = typeSelects[0];
    fireEvent.change(gradeLevelType, { target: { value: "number" } });
    expect(latest).not.toBeNull();
    const grade = latest!.field_mappings.find((m) => m.field_name === "grade_level")!;
    expect(grade.field_type).toBe("number");
    expect(grade.default).toBeUndefined();
  });

  it("clears default when multiple toggles on a selection field", () => {
    const entity = makeEntity();
    let latest: EntityResult | null = null;
    const { container } = render(
      <EntityCard
        entity={entity}
        index={0}
        onUpdate={(_, updated) => {
          latest = updated;
        }}
      />
    );
    const optionsButtons = container.querySelectorAll(".field-row__options-btn");
    fireEvent.click(optionsButtons[0]);
    const multipleCheckbox = container.querySelector(
      ".options-editor__multiple input[type='checkbox']"
    ) as HTMLInputElement;
    fireEvent.click(multipleCheckbox);
    expect(latest).not.toBeNull();
    const subjects = latest!.field_mappings.find((m) => m.field_name === "subjects")!;
    expect(subjects.multiple).toBe(false);
    expect(subjects.default).toBeUndefined();
  });

  it("does NOT clear default when only options change (no multi toggle)", () => {
    const entity = makeEntity();
    let latest: EntityResult | null = null;
    const { container } = render(
      <EntityCard
        entity={entity}
        index={0}
        onUpdate={(_, updated) => {
          latest = updated;
        }}
      />
    );
    const optionsButtons = container.querySelectorAll(".field-row__options-btn");
    fireEvent.click(optionsButtons[0]);
    const addInput = container.querySelector(
      ".options-editor__input"
    ) as HTMLInputElement;
    fireEvent.change(addInput, { target: { value: "history" } });
    const addBtn = container.querySelector(
      ".options-editor__add .btn"
    ) as HTMLButtonElement;
    fireEvent.click(addBtn);
    expect(latest).not.toBeNull();
    const subjects = latest!.field_mappings.find((m) => m.field_name === "subjects")!;
    expect(subjects.options).toEqual(["math", "science", "history"]);
    expect(subjects.multiple).toBe(true);
    expect(subjects.default).toEqual(["math"]);
  });
});
