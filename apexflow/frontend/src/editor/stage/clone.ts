// Structural deep copy for `GuardRef`/`EffectRef` values. These are plain
// JSON wire objects by construction (`schema.py`), so
// `JSON.parse(JSON.stringify(...))` is exact and cheap.
//
// A leaf module (no imports of its own) so both `read.ts` and `write.ts` can
// depend on it without either depending on the other:
//
// - `read.ts` uses it so the model returned by `readStageModel` shares no
//   object identity with the `machine` it was read from — otherwise the
//   round-trip test would partly pass on aliased fields instead of actually
//   comparing values, and an editor task doing `group.effects.push(...)` in
//   place would silently mutate the definition the model was read from.
// - `write.ts` uses it so the machine returned by `writeMachine` shares no
//   object identity with the `MoveGroup`s it was written from — otherwise
//   every emitted transition holds the SAME `GuardRef`/`EffectRef` objects
//   the live `MoveGroup` still owns, and an in-place edit after a save (e.g.
//   `group.effects[0].params.template = ...`) mutates the machine that was
//   just written; for a split `_withdraw_pair`/`_drop_pair` sibling, it
//   mutates the sibling too.
export function cloneRef<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
