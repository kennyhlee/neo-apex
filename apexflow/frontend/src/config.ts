// Ported from admindash/frontend/src/config.ts (interface map §1c).
import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const APEXFLOW_API_URL =
  import.meta.env.VITE_APEXFLOW_API_URL || svcUrl('apexflow-backend');
