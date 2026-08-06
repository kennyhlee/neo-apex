/**
 * Best-effort coercion for a numeric value that crossed DataCore's
 * flattened-row boundary. Every scalar column in a `list_entities`/
 * `get_entity` result comes back stringified regardless of the model's
 * declared field type — `workflow_definition.version` is declared `type:
 * "number"` in base_model.json, but the wire value is `"1"`, not `1`. Our
 * own TS types (`DefinitionListEntry.version`, `DefinitionDetail.version`,
 * `DefinitionRow.version`, `.open_instances`) all say `number` because
 * that's the *intended* shape, not because the JSON actually arrives that
 * way — trusting the annotation without coercing is exactly how
 * `bundle.definition.version + 1` silently produces the string `"11"`
 * instead of the number `2`.
 *
 * Backend precedent for the identical problem: `app/workflows/definitions.py`'s
 * `_as_int` does this same best-effort coercion server-side, for the same
 * reason, on the same flattened `version` column (model-impact route).
 *
 * Falls back to 0 (not NaN) so a badly-shaped value degrades to "no
 * arithmetic explosion" rather than poisoning downstream math with NaN.
 */
export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
