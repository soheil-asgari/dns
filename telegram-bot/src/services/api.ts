import axios from 'axios';

const api = axios.create({
  baseURL: process.env.API_URL || 'http://backend-api:8080',
  timeout: 10000,
});

export async function resolveDomain(domain: string) {
  const { data } = await api.get(`/api/dns/resolve/${domain}`);
  return data;
}

export async function getGamingDomains() {
  const { data } = await api.get('/api/dns/gaming-domains');
  return data;
}

export async function syncToRedis() {
  const { data } = await api.post('/api/dns/sync-redis');
  return data;
}

export async function getStats() {
  const domains = await getGamingDomains();
  return {
    totalGamingDomains: domains.length,
    activeDomains: domains.filter((d: any) => d.isActive).length,
  };
}