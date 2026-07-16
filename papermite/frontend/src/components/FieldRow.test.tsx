import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
  defaultVal?: unknown;
  onUpdate?: (fieldName: string, value: unknown) => void;
  onRequiredToggle?: (fieldName: string, required: boolean) => void;
  onTypeChange?: (fieldName: string, fieldType: FieldType) => void;
  onOptionsChange?: (
    fieldName: string,
    options: string[],
    multiple: boolean
  ) => void;
  onDefaultChange?: (fieldName: string, value: unknown) => void;
  onDelete?: () => void;
}

function renderRow(overrides: FieldRowTestProps = {}) {
  const onUpdate = overrides.onUpdate ?? vi.fn();
  const onRequiredToggle = overrides.onRequiredToggle ?? vi.fn();
  const onTypeChange = overrides.onTypeChange ?? vi.fn();
  const onOptionsChange = overrides.onOptionsChange ?? vi.fn();
  const onDefaultChange = overrides.onDefaultChange ?? vi.fn();

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
          defaultVal={overrides.defaultVal}
          onUpdate={onUpdate}
          onRequiredToggle={onRequiredToggle}
          onTypeChange={onTypeChange}
          onOptionsChange={onOptionsChange}
          onDefaultChange={onDefaultChange}
          onDelete={overrides.onDelete}
        />
      </tbody>
    </table>
  );

  return { ...utils, onUpdate, onRequiredToggle, onTypeChange, onOptionsChange, onDefaultChange };
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
      source: "custom_field",
      value: "Active",
      fieldType: "selection",
      options: ["Active", "Inactive"],
      multiple: false,
    });

    // Scope to the Value cell so the Default cell's <select> doesn't interfere.
    const valueCell = screen.getByTestId("field-row-value");
    const select = within(valueCell).getByRole("combobox") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("Active");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "Active", "Inactive"]);

    fireEvent.change(select, { target: { value: "Inactive" } });
    expect(onUpdate).toHaveBeenCalledWith("grade_level", "Inactive");
  });

  it("renders one checkbox per option inline for multi-select with options", () => {
    const { onUpdate } = renderRow({
      source: "custom_field",
      fieldName: "days_of_week",
      value: ["Mon"],
      fieldType: "selection",
      options: ["Mon", "Tue", "Wed"],
      multiple: true,
    });

    // Scope to the Value cell so the Default cell's checkboxes don't interfere.
    const valueCell = screen.getByTestId("field-row-value");
    const optionBoxes = within(valueCell).getAllByRole("checkbox");
    expect(optionBoxes).toHaveLength(3);
    expect((optionBoxes[0] as HTMLInputElement).checked).toBe(true);
    expect((optionBoxes[1] as HTMLInputElement).checked).toBe(false);
    expect((optionBoxes[2] as HTMLInputElement).checked).toBe(false);

    fireEvent.click(optionBoxes[1]);
    expect(onUpdate).toHaveBeenCalledWith("days_of_week", ["Mon", "Tue"]);
  });

  it("falls back to text input when selection has no options yet", () => {
    renderRow({
      source: "custom_field",
      value: "seed",
      fieldType: "selection",
      options: [],
    });

    const valueCell = screen.getByTestId("field-row-value");
    expect(within(valueCell).queryByRole("combobox")).toBeNull();
    expect(within(valueCell).getByText("seed")).toBeInTheDocument();
    fireEvent.click(within(valueCell).getByText("seed"));
    expect(within(valueCell).getByDisplayValue("seed")).toBeInTheDocument();
  });

  // Issue #66 — base fields do not invite value entry in the model form.
  it("renders a base field's Value read-only (no click-to-edit input)", () => {
    renderRow({
      source: "base_model",
      fieldName: "first_name",
      value: "Ada",
      fieldType: "str",
    });
    const valueCell = screen.getByTestId("field-row-value");
    // Value is shown but not editable — clicking does not open an input.
    expect(within(valueCell).getByText("Ada")).toBeInTheDocument();
    fireEvent.click(within(valueCell).getByText("Ada"));
    expect(within(valueCell).queryByRole("textbox")).toBeNull();
  });

  it("renders a base selection field's Value read-only (no inline control)", () => {
    renderRow({
      source: "base_model",
      fieldName: "grade_level",
      value: ["9", "10"],
      fieldType: "selection",
      options: ["9", "10", "11"],
      multiple: true,
    });
    const valueCell = screen.getByTestId("field-row-value");
    expect(within(valueCell).queryByRole("checkbox")).toBeNull();
    expect(within(valueCell).getByText("9, 10")).toBeInTheDocument();
  });

  it("marks an auto-generated *_id base field and locks its Value and Default", () => {
    renderRow({
      source: "base_model",
      fieldName: "student_id",
      value: "abc123",
      fieldType: "str",
      defaultVal: undefined,
    });
    expect(screen.getByText("auto")).toBeInTheDocument();
    const valueCell = screen.getByTestId("field-row-value");
    expect(within(valueCell).getByText("auto-generated")).toBeInTheDocument();
    // Default cell has no editable input for an auto-generated id.
    const defaultCell = screen.getByTestId("field-row-default");
    fireEvent.click(defaultCell.querySelector(".field-row__default-display--readonly") as HTMLElement);
    expect(defaultCell.querySelector("input")).toBeNull();
  });

  it("renders an empty Default cell click-to-edit input", () => {
    const { onDefaultChange } = renderRow({ fieldType: "str" });
    const cell = screen.getByTestId("field-row-default");
    const display = cell.querySelector(".field-row__default-display") as HTMLElement;
    expect(display).toBeInTheDocument();
    fireEvent.click(display);
    const input = cell.querySelector("input") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", "9");
  });

  it("Escape in the Default input cancels without firing onDefaultChange", () => {
    const { onDefaultChange } = renderRow({ fieldType: "str", defaultVal: "9" });
    const cell = screen.getByTestId("field-row-default");
    const display = cell.querySelector(".field-row__default-display") as HTMLElement;
    fireEvent.click(display);
    const input = cell.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "11" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onDefaultChange).not.toHaveBeenCalled();
  });

  it("clearing the Default input commits undefined (not the empty string)", () => {
    const { onDefaultChange } = renderRow({ fieldType: "str", defaultVal: "9" });
    const cell = screen.getByTestId("field-row-default");
    const display = cell.querySelector(".field-row__default-display") as HTMLElement;
    fireEvent.click(display);
    const input = cell.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", undefined);
  });

  it("bool Default cell renders a checkbox bound to defaultVal", () => {
    const { onDefaultChange } = renderRow({ fieldType: "bool", defaultVal: false });
    const cell = screen.getByTestId("field-row-default");
    const checkbox = cell.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", true);
  });

  it("selection-single Default cell renders a <select> with — none — option", () => {
    const { onDefaultChange } = renderRow({
      fieldType: "selection",
      options: ["9", "10", "11"],
      multiple: false,
      defaultVal: "10",
    });
    const cell = screen.getByTestId("field-row-default");
    const select = cell.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("10");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "9", "10", "11"]);
    fireEvent.change(select, { target: { value: "" } });
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", undefined);
  });

  it("selection-multi Default cell renders checkboxes and commits arrays", () => {
    const { onDefaultChange } = renderRow({
      fieldType: "selection",
      options: ["math", "science", "history"],
      multiple: true,
      defaultVal: ["math"],
    });
    const cell = screen.getByTestId("field-row-default");
    const checkboxes = cell.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    fireEvent.click(checkboxes[1]);
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", ["math", "science"]);
  });

  it("selection-multi clearing the last checked option commits undefined", () => {
    const { onDefaultChange } = renderRow({
      fieldType: "selection",
      options: ["math", "science"],
      multiple: true,
      defaultVal: ["math"],
    });
    const cell = screen.getByTestId("field-row-default");
    const checkboxes = cell.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
    fireEvent.click(checkboxes[0]);
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", undefined);
  });
});
