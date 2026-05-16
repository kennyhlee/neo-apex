import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FieldRow from "./FieldRow";
import type { FieldType } from "../types/models";

interface FieldRowTestProps {
  fieldName?: string;
  value?: unknown;
  source?: "base_model" | "custom_field";
  required?: boolean;
  fieldType?: FieldType;
  options?: string[];
  multiple?: boolean;
  onUpdate?: (fieldName: string, value: unknown) => void;
  onRequiredToggle?: (fieldName: string, required: boolean) => void;
  onTypeChange?: (fieldName: string, fieldType: FieldType) => void;
  onOptionsChange?: (
    fieldName: string,
    options: string[],
    multiple: boolean
  ) => void;
  onDelete?: () => void;
}

function renderRow(overrides: FieldRowTestProps = {}) {
  const onUpdate = overrides.onUpdate ?? vi.fn();
  const onRequiredToggle = overrides.onRequiredToggle ?? vi.fn();
  const onTypeChange = overrides.onTypeChange ?? vi.fn();
  const onOptionsChange = overrides.onOptionsChange ?? vi.fn();

  const utils = render(
    <table>
      <tbody>
        <FieldRow
          fieldName={overrides.fieldName ?? "grade_level"}
          value={overrides.value}
          source={overrides.source ?? "custom_field"}
          required={overrides.required ?? false}
          fieldType={overrides.fieldType ?? "str"}
          options={overrides.options}
          multiple={overrides.multiple}
          onUpdate={onUpdate}
          onRequiredToggle={onRequiredToggle}
          onTypeChange={onTypeChange}
          onOptionsChange={onOptionsChange}
          onDelete={overrides.onDelete}
        />
      </tbody>
    </table>
  );

  return { ...utils, onUpdate, onRequiredToggle, onTypeChange, onOptionsChange };
}

describe("FieldRow", () => {
  it("renders an object value as JSON, never as [object Object]", () => {
    renderRow({ value: { a: 1 }, fieldType: "str" });
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it("initializes the text-edit input via JSON.stringify for array-of-objects", () => {
    renderRow({ value: [{ x: 1 }], fieldType: "str" });
    fireEvent.click(screen.getByText('[{"x":1}]'));
    const input = screen.getByDisplayValue('[{"x":1}]') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).not.toBe("[object Object]");
  });

  it("renders a <select> inline for single-select with options (no click required)", () => {
    const { onUpdate } = renderRow({
      // base_model so the data-type column renders a locked <span>, not a <select>;
      // this keeps the Value cell's <select> the only combobox in the row.
      source: "base_model",
      required: true,
      value: "Active",
      fieldType: "selection",
      options: ["Active", "Inactive"],
      multiple: false,
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("Active");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "Active", "Inactive"]);

    fireEvent.change(select, { target: { value: "Inactive" } });
    expect(onUpdate).toHaveBeenCalledWith("grade_level", "Inactive");
  });

  it("renders one checkbox per option inline for multi-select with options", () => {
    const { onUpdate } = renderRow({
      source: "base_model",
      required: true,
      fieldName: "days_of_week",
      value: ["Mon"],
      fieldType: "selection",
      options: ["Mon", "Tue", "Wed"],
      multiple: true,
    });

    const checkboxes = screen.getAllByRole("checkbox");
    // The Required column also has a checkbox, so we filter by accessible name.
    const optionBoxes = checkboxes.filter((cb) =>
      ["Mon", "Tue", "Wed"].some((label) =>
        cb.closest("label")?.textContent?.includes(label)
      )
    );
    expect(optionBoxes).toHaveLength(3);
    expect((optionBoxes[0] as HTMLInputElement).checked).toBe(true);
    expect((optionBoxes[1] as HTMLInputElement).checked).toBe(false);
    expect((optionBoxes[2] as HTMLInputElement).checked).toBe(false);

    fireEvent.click(optionBoxes[1]);
    expect(onUpdate).toHaveBeenCalledWith("days_of_week", ["Mon", "Tue"]);
  });

  it("falls back to text input when selection has no options yet", () => {
    renderRow({
      source: "base_model",
      value: "seed",
      fieldType: "selection",
      options: [],
    });

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("seed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("seed"));
    expect(screen.getByDisplayValue("seed")).toBeInTheDocument();
  });
});
