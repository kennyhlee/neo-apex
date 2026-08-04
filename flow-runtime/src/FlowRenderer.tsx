import type { FlowMode, RegistrationConfigDef } from './types';
import { FlowLocaleContext, flowLocale, type Locale } from './i18n';

export interface FlowRendererProps {
  config: RegistrationConfigDef;
  mode: FlowMode;
  /** Host-supplied locale. Falls back to `flowLocale()` (a one-time
   *  localStorage read) when omitted. */
  locale?: Locale;
}

/** Placeholder — Plan 4 implements the real block-walking renderer. */
export function FlowRenderer({ config, mode, locale }: FlowRendererProps) {
  const resolvedLocale = locale ?? flowLocale();
  return (
    <FlowLocaleContext.Provider value={resolvedLocale}>
      <div data-flow-mode={mode}>
        <ol>
          {config.blocks.map((b) => (
            <li key={b.block_id}>{b.title}</li>
          ))}
        </ol>
      </div>
    </FlowLocaleContext.Provider>
  );
}
