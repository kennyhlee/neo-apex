export interface FamilySignature {
  email: string;
  phone: string;
  name: string;
  address: string;
}

function text(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

export function normalizeSignature(fields: Record<string, unknown>): FamilySignature {
  return {
    email: text(fields.primary_email),
    phone: digits(fields.primary_phone),
    name: text(fields.family_name),
    address: text(fields.primary_address),
  };
}

export function signatureKey(sig: FamilySignature): string {
  if (sig.email) return `e:${sig.email}`;
  if (sig.phone) return `p:${sig.phone}`;
  if (sig.name && sig.address) return `na:${sig.name}|${sig.address}`;
  return '';
}

export function matchFamily(
  sig: FamilySignature,
  candidates: Array<{ entity_id: string } & Record<string, unknown>>,
): string | null {
  const key = signatureKey(sig);
  if (!key) return null;
  for (const c of candidates) {
    if (signatureKey(normalizeSignature(c)) === key) return c.entity_id;
  }
  return null;
}

export function clusterSiblings(sigs: FamilySignature[]): number[] {
  const keyToCluster = new Map<string, number>();
  let next = 0;
  return sigs.map((sig) => {
    const key = signatureKey(sig);
    if (!key) return -1;
    if (!keyToCluster.has(key)) keyToCluster.set(key, next++);
    return keyToCluster.get(key)!;
  });
}
