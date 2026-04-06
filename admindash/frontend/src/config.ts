import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const DATACORE_URL = import.meta.env.VITE_DATACORE_URL || svcUrl("datacore");
export const DATACORE_AUTH_URL = import.meta.env.VITE_DATACORE_AUTH_URL || `${DATACORE_URL}/auth`;
export const PAPERMITE_BACKEND_URL = import.meta.env.VITE_PAPERMITE_BACKEND_URL || svcUrl("papermite-backend");
