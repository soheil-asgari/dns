import { create } from 'zustand';
import { GamingDomain } from '../services/api';

interface DnsState {
  gamingDomains: GamingDomain[];
  selectedDomain: GamingDomain | null;
  isSyncing: boolean;
  stats: {
    totalQueries: number;
    cachedResponses: number;
    gamingDomainsCount: number;
    activeRules: number;
  };
  setGamingDomains: (domains: GamingDomain[]) => void;
  setSelectedDomain: (domain: GamingDomain | null) => void;
  setIsSyncing: (syncing: boolean) => void;
  setStats: (stats: DnsState['stats']) => void;
}

export const useDnsStore = create<DnsState>((set) => ({
  gamingDomains: [],
  selectedDomain: null,
  isSyncing: false,
  stats: {
    totalQueries: 0,
    cachedResponses: 0,
    gamingDomainsCount: 0,
    activeRules: 0,
  },
  setGamingDomains: (domains) => set({ gamingDomains: domains }),
  setSelectedDomain: (domain) => set({ selectedDomain: domain }),
  setIsSyncing: (syncing) => set({ isSyncing: syncing }),
  setStats: (stats) => set({ stats }),
}));