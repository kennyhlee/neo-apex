import type { FlowMode, RegistrationConfigDef } from './types';

export interface FlowRendererProps {
  config: RegistrationConfigDef;
  mode: FlowMode;
}

/** Placeholder — Plan 4 implements the real block-walking renderer. */
export function FlowRenderer({ config, mode }: FlowRendererProps) {
  return (
    <div data-flow-mode={mode}>
      <ol>
        {config.blocks.map((b) => (
          <li key={b.block_id}>{b.title}</li>
        ))}
      </ol>
    </div>
  );
}
