import { useQuery } from 'react-query';
import { Globe, Gamepad2, Shield, Activity } from 'lucide-react';
import { dnsApi } from '../services/api';

const statCards = [
  { label: 'Total Queries', value: '12,847', icon: Activity, change: '+12%', color: 'text-emerald-500' },
  { label: 'Gaming Domains', value: '10', icon: Gamepad2, change: 'Active', color: 'text-indigo-500' },
  { label: 'DNS Records', value: '156', icon: Globe, change: '+3 today', color: 'text-blue-500' },
  { label: 'Proxy Rules', value: '8', icon: Shield, change: 'All active', color: 'text-amber-500' },
];

export default function Dashboard() {
  const { data: domains } = useQuery('gamingDomains', () => dnsApi.getGamingDomains());

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="card">
            <div className="flex items-center justify-between mb-4">
              <card.icon className={`w-6 h-6 ${card.color}`} />
              <span className={`text-sm font-medium ${card.color}`}>{card.change}</span>
            </div>
            <p className="text-2xl font-bold">{card.value}</p>
            <p className="text-sm text-slate-400">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Gaming Domains</h3>
          <div className="space-y-3">
            {domains?.data?.slice(0, 5).map((domain) => (
              <div key={domain.id} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                <div>
                  <p className="font-medium">{domain.gameName}</p>
                  <p className="text-sm text-slate-400">{domain.domain}</p>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  domain.isActive ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-600 text-slate-400'
                }`}>
                  {domain.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Query Analytics</h3>
          <div className="flex items-center justify-center h-48 text-slate-500">
            <Activity className="w-12 h-12" />
            <span className="ml-3">Query graph will render here</span>
          </div>
        </div>
      </div>
    </div>
  );
}