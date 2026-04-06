import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const LAUNCHPAD_BACKEND_URL = import.meta.env.VITE_LAUNCHPAD_BACKEND_URL || svcUrl("launchpad-backend");
export const LAUNCHPAD_API_URL = `${LAUNCHPAD_BACKEND_URL}/api`;
export const PAPERMITE_FRONTEND_URL = import.meta.env.VITE_PAPERMITE_FRONTEND_URL || svcUrl("papermite-frontend");
