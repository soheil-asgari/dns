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
  getRecords: () => api.get<DnsRecord[]>('/dns/records'),
  createRecord: (record: Omit<DnsRecord, 'id' | 'createdAt' | 'updatedAt'>) => api.post<DnsRecord>('/dns/records', record),
  updateRecord: (id: string, record: Partial<DnsRecord>) => api.put<DnsRecord>(`/dns/records/${id}`, record),
  deleteRecord: (id: string) => api.delete(`/dns/records/${id}`),
};

export default api;