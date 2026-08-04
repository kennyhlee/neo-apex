import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const ENROLLX_API_URL =
  import.meta.env.VITE_ENROLLX_API_URL || svcUrl("enrollx-backend");
