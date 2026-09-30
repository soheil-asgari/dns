import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
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

export interface AdminStats {
  totalUsers: number;
  activeSubscriptions: number;
  totalPaidSubscriptions: number;
  trialSubscriptions: number;
  totalRevenue: number;
  totalTransactions: number;
  successfulTransactions: number;
  usersWithIp: number;
}

export interface UserInfo {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  createdAt: string;
  subscriptions: any[];
  activeSubscription: any;
  hasPurchased: boolean;
  transactions: any[];
}

export interface BotAdmin {
  id: string;
  username: string;
  role: string;
  permissions: string;
  createdAt: string;
}

export const settingsApi = {
  getBotToken: () => api.get('/settings/bot-token'),
  updateBotToken: (token: string) => api.put('/settings/bot-token', { token }),
  testBotToken: (token: string) => api.post('/settings/bot-token/test', { token }),
  getBotAdminIds: () => api.get<{ adminIds: number[] }>('/settings/bot-admin-ids'),
  updateBotAdminIds: (adminIds: number[]) => api.put('/settings/bot-admin-ids', { adminIds }),
};

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

export const adminApi = {
  getStats: () => api.get<AdminStats>('/admin/stats'),
  getUsers: (page = 1, pageSize = 20, search?: string) =>
    api.get<{ users: UserInfo[]; total: number; page: number; pageSize: number }>('/admin/users', { params: { page, pageSize, search } }),
  getUser: (telegramId: number) => api.get(`/admin/users/${telegramId}`),
  addCredit: (telegramId: number, days: number) => api.post(`/admin/users/${telegramId}/add-credit`, { days }),
  getBotAdmins: () => api.get<{ admins: BotAdmin[] }>('/admin/bot-admins'),
  createBotAdmin: (data: { username: string; password: string; role?: string; permissions?: string }) =>
    api.post('/admin/bot-admins', data),
  updateBotAdmin: (id: string, data: { role?: string; permissions?: string }) =>
    api.put(`/admin/bot-admins/${id}`, data),
  deleteBotAdmin: (id: string) => api.delete(`/admin/bot-admins/${id}`),
};

export default api;