import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const PAPERMITE_BACKEND_URL = import.meta.env.VITE_PAPERMITE_BACKEND_URL || svcUrl("papermite-backend");
export const PAPERMITE_API_URL = `${PAPERMITE_BACKEND_URL}/api`;
