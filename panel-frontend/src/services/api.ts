import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach auth token from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Intercept 401 responses to redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      // Only redirect if not already on login page
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

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

export interface SubdomainDiscoveryResult {
  domain: string;
  count: number;
  subdomains: string[];
}

export const dnsApi = {
  resolve: (domain: string) => api.get(`/dns/resolve/${domain}`),
  getGamingDomains: () => api.get<GamingDomain[]>('/dns/gaming-domains'),
  syncRedis: () => api.post('/dns/sync-redis'),
  bulkCreateGamingDomains: (domains: string[], gameName?: string) => api.post('/dns/gaming-domains/bulk', { domains, gameName }),
  getRecords: () => api.get<DnsRecord[]>('/dns/records'),
  createRecord: (record: Omit<DnsRecord, 'id' | 'createdAt' | 'updatedAt'>) => api.post<DnsRecord>('/dns/records', record),
  updateRecord: (id: string, record: Partial<DnsRecord>) => api.put<DnsRecord>(`/dns/records/${id}`, record),
  deleteRecord: (id: string) => api.delete(`/dns/records/${id}`),
  discoverSubdomains: (domain: string) => api.get<SubdomainDiscoveryResult>('/DomainDiscovery/subdomains', { params: { domain } }),
};

export default api;