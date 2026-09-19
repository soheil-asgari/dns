import { useQuery } from 'react-query';
import { dnsApi } from '../services/api';
import { Gamepad2 } from 'lucide-react';
import { useAuth } from '../store/authStore';

export default function GamingDomains() {
  const { isAuthenticated } = useAuth();
  const { data, isLoading } = useQuery('gamingDomains', () => dnsApi.getGamingDomains(), {
    enabled: isAuthenticated,
  });

  if (isLoading) return <div className="text-slate-400">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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