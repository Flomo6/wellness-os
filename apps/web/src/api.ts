export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

async function req(path: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant-Key': 'dev-tenant-key', // TODO: replace with real
    'X-Bot-Token': 'dev-bot-token',
    'X-Tenant-Id': import.meta.env.VITE_TENANT_ID || '',
    ...(options.headers || {})
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  staff: () => req('/v1/staff'),
  services: () => req('/v1/services'),
  availability: (args: { service_id: string, date_from: string, date_to: string, preferred_staff?: string }) =>
    req(`/v1/availability?service_id=${args.service_id}&date_from=${args.date_from}&date_to=${args.date_to}${args.preferred_staff ? `&preferred_staff=${args.preferred_staff}`:''}`),
  createAppointment: (body: any) =>
    req('/v1/appointments', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body)
    })
};
