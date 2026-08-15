// Mirrors hooks/useToast.ts: the context is nullable so that using it outside
// the provider is a loud error rather than a silently dead toggle.
import { useContext } from 'react';
import { AssistantContext, type AssistantApi } from '../contexts/assistantStore.ts';

/** Open/close the assistant drawer from anywhere under <AssistantProvider>. */
export function useAssistant(): AssistantApi {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistant must be used within <AssistantProvider>');
  return ctx;
}

export default useAssistant;
