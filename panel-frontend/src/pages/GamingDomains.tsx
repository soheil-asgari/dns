import { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { dnsApi, SubdomainDiscoveryResult } from '../services/api';
import { Gamepad2, Search, Loader2, CheckSquare, Square, Plus, X } from 'lucide-react';

const token = () => localStorage.getItem('auth_token');

export default function GamingDomains() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery('gamingDomains', () => dnsApi.getGamingDomains(), {
    enabled: !!token(),
  });

  // Subdomain discovery state
  const [searchDomain, setSearchDomain] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<SubdomainDiscoveryResult | null>(null);
  const [selectedSubdomains, setSelectedSubdomains] = useState<Set<string>>(new Set());
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);

  const handleDiscover = async () => {
    const domain = searchDomain.trim().toLowerCase();
    if (!domain) return;

    setIsSearching(true);
    setSearchError(null);
    setDiscoveryResult(null);
    setSelectedSubdomains(new Set());
    setAddSuccess(false);

    try {
      const res = await dnsApi.discoverSubdomains(domain);
      setDiscoveryResult(res.data);
      // Auto-select all by default
      setSelectedSubdomains(new Set(res.data.subdomains));
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to discover subdomains';
      setSearchError(msg);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleDiscover();
  };

  const toggleSelectAll = () => {
    if (!discoveryResult) return;
    if (selectedSubdomains.size === discoveryResult.subdomains.length) {
      setSelectedSubdomains(new Set());
    } else {
      setSelectedSubdomains(new Set(discoveryResult.subdomains));
    }
  };

  const toggleSubdomain = (sub: string) => {
    setSelectedSubdomains((prev) => {
      const next = new Set(prev);
      if (next.has(sub)) {
        next.delete(sub);
      } else {
        next.add(sub);
      }
      return next;
    });
  };

  const handleAddSelected = async () => {
    if (selectedSubdomains.size === 0 || !discoveryResult) return;

    setIsAdding(true);
    try {
      const selected = Array.from(selectedSubdomains);
      await dnsApi.bulkCreateGamingDomains(selected, discoveryResult.domain);

      // Refresh the gaming domains list
      queryClient.invalidateQueries('gamingDomains');

      setAddSuccess(true);
      setDiscoveryResult(null);
      setSearchDomain('');
      setSelectedSubdomains(new Set());

      // Auto-clear success message after 3s
      setTimeout(() => setAddSuccess(false), 3000);
    } catch (err: any) {
      setSearchError(err?.response?.data?.message || 'Failed to add selected subdomains');
    } finally {
      setIsAdding(false);
    }
  };

  const allSelected = discoveryResult && selectedSubdomains.size === discoveryResult.subdomains.length;

  return (
    <div className="space-y-6">
      {/* Subdomain Discovery Section */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Search className="w-5 h-5 text-indigo-500" />
          <span>Discover Subdomains</span>
        </h2>

        {/* Search input row */}
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            value={searchDomain}
            onChange={(e) => setSearchDomain(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter domain (e.g., callofduty.com)"
            className="flex-1 min-w-[200px] bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            disabled={isSearching}
          />
          <button
            onClick={handleDiscover}
            disabled={isSearching || !searchDomain.trim()}
            className="btn-primary flex items-center gap-2 whitespace-nowrap"
          >
            {isSearching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                جستجو و یافتن زیردامنه‌ها
              </>
            )}
          </button>
        </div>

        {/* Error display */}
        {searchError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm mb-4 flex items-center gap-2">
            <X className="w-4 h-4 flex-shrink-0" />
            {searchError}
            <button onClick={() => setSearchError(null)} className="ml-auto text-red-400 hover:text-red-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Success message */}
        {addSuccess && (
          <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg px-4 py-3 text-emerald-300 text-sm mb-4">
            Subdomains added and synced to Redis successfully!
          </div>
        )}

        {/* Loading spinner (full replacement) */}
        {isSearching && !discoveryResult && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="spinner" />
            <p className="text-slate-400 mt-4 text-sm">Querying Certificate Transparency logs...</p>
          </div>
        )}

        {/* Discovery results */}
        {discoveryResult && !isSearching && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm text-slate-400">
              <span>
                Found <strong className="text-white">{discoveryResult.count}</strong> subdomains for{' '}
                <strong className="text-white">{discoveryResult.domain}</strong>
              </span>
              <span className="text-xs text-slate-500">
                {selectedSubdomains.size} selected
              </span>
            </div>

            {/* Select All checkbox */}
            <div className="flex items-center gap-3 py-2 border-b border-slate-700">
              <button onClick={toggleSelectAll} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                {allSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
              </button>
              <span className="text-sm font-medium text-slate-300">انتخاب همه</span>
            </div>

            {/* Scrollable subdomain list */}
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {discoveryResult.subdomains.map((sub) => (
                <div
                  key={sub}
                  className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-slate-700/50 transition-colors"
                >
                  <button
                    onClick={() => toggleSubdomain(sub)}
                    className="text-indigo-400 hover:text-indigo-300 transition-colors flex-shrink-0"
                  >
                    {selectedSubdomains.has(sub) ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                  <span className="text-sm text-slate-200 truncate">{sub}</span>
                </div>
              ))}
            </div>

            {/* Confirm add button */}
            <button
              onClick={handleAddSelected}
              disabled={selectedSubdomains.size === 0 || isAdding}
              className="btn-primary flex items-center gap-2 w-full justify-center"
            >
              {isAdding ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  افزودن موارد انتخاب‌شده به لیست ({selectedSubdomains.size})
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Existing Gaming Domains Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading && (
          <div className="col-span-full flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        )}
        {data?.data.map((domain) => (
          <div key={domain.id} className="card">
            <div className="flex items-center justify-between mb-3">
              <Gamepad2 className="w-8 h-8 text-indigo-500" />
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                domain.isActive ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-600 text-slate-400'
              }`}>
                {domain.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <h3 className="font-semibold text-lg">{domain.gameName}</h3>
            <p className="text-sm text-slate-400 mt-1">{domain.domain}</p>
            <div className="mt-4 pt-4 border-t border-slate-700 flex justify-between text-sm">
              <span className="text-slate-400">Priority: {domain.priority}</span>
              <span className="text-slate-400">
                {domain.customIp ? `IP: ${domain.customIp}` : 'Auto-resolve'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}