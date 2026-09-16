import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

export interface DnsRecord {
  id: string;
  domain: string;
  recordType: string;
  value: string;
  ttl: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface GamingDomain {
  id: string;
  domain: string;
  gameName: string;
  customIp: string | null;
  priority: number;
  isActive: boolean;
}

export interface ProxyRule {
  id: string;
  name: string;
  sourcePattern: string;
  destination: string;
  port: number;
  protocol: string;
  isActive: boolean;
  priority: number;
}

export const dnsApi = {
  resolve: (domain: string) => api.get(`/dns/resolve/${domain}`),
  getGamingDomains: () => api.get<GamingDomain[]>('/dns/gaming-domains'),
  syncRedis: () => api.post('/dns/sync-redis'),
};

export default api;