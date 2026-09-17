import { create } from 'zustand';
import { DnsRecord, GamingDomain } from '../services/api';

interface DnsState {
  records: DnsRecord[];
  gamingDomains: GamingDomain[];
  selectedDomain: GamingDomain | null;
  isSyncing: boolean;
  stats: {
    totalQueries: number;
    cachedResponses: number;
    gamingDomainsCount: number;
    activeRules: number;
  };
  setRecords: (records: DnsRecord[]) => void;
  addRecord: (record: DnsRecord) => void;
  updateRecord: (id: string, record: DnsRecord) => void;
  removeRecord: (id: string) => void;
  setGamingDomains: (domains: GamingDomain[]) => void;
  setSelectedDomain: (domain: GamingDomain | null) => void;
  setIsSyncing: (syncing: boolean) => void;
  setStats: (stats: DnsState['stats']) => void;
}

export const useDnsStore = create<DnsState>((set) => ({
  records: [],
  gamingDomains: [],
  selectedDomain: null,
  isSyncing: false,
  stats: {
    totalQueries: 0,
    cachedResponses: 0,
    gamingDomainsCount: 0,
    activeRules: 0,
  },
  setRecords: (records) => set({ records }),
  addRecord: (record) => set((state) => ({ records: [...state.records, record] })),
  updateRecord: (id, updated) =>
    set((state) => ({
      records: state.records.map((r) => (r.id === id ? updated : r)),
    })),
  removeRecord: (id) =>
    set((state) => ({
      records: state.records.filter((r) => r.id !== id),
    })),
  setGamingDomains: (domains) => set({ gamingDomains: domains }),
  setSelectedDomain: (domain) => set({ selectedDomain: domain }),
  setIsSyncing: (syncing) => set({ isSyncing: syncing }),
  setStats: (stats) => set({ stats }),
}));