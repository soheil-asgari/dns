import { useQuery } from 'react-query';
import { Globe, Gamepad2, Shield, Activity, Users, DollarSign, CheckCircle, Clock } from 'lucide-react';
import { dnsApi, adminApi } from '../services/api';

const token = () => localStorage.getItem('auth_token');

export default function Dashboard() {
  const { data: domains } = useQuery('gamingDomains', () => dnsApi.getGamingDomains(), {
    enabled: !!token(),
    retry: false,
  });

  const { data: stats } = useQuery('adminStats', () => adminApi.getStats(), {
    enabled: !!token(),
    retry: false,
  });

  const { data: records } = useQuery('dnsRecords', () => dnsApi.getRecords(), {
    enabled: !!token(),
    retry: false,
  });

  const statCards = [
    { 
      label: 'Total Users', 
      value: stats?.data?.totalUsers?.toLocaleString('fa-IR') || '—', 
      icon: Users, 
      change: stats?.data?.activeSubscriptions ? `${stats.data.activeSubscriptions} active` : '', 
      color: 'text-blue-500' 
    },
    { 
      label: 'Active Subscriptions', 
      value: stats?.data?.activeSubscriptions?.toLocaleString('fa-IR') || '—', 
      icon: CheckCircle, 
      change: stats?.data?.usersWithIp ? `${stats.data.usersWithIp} with IP` : '', 
      color: 'text-emerald-500' 
    },
    { 
      label: 'Gaming Domains', 
      value: domains?.data?.length?.toString() || '—', 
      icon: Gamepad2, 
      change: `${domains?.data?.filter(d => d.isActive).length || 0} active`, 
      color: 'text-indigo-500' 
    },
    { 
      label: 'DNS Records', 
      value: records?.data?.length?.toString() || '—', 
      icon: Globe, 
      change: `${records?.data?.filter(r => r.isActive).length || 0} active`, 
      color: 'text-blue-500' 
    },
    { 
      label: 'Revenue', 
      value: stats?.data?.totalRevenue ? `${(stats.data.totalRevenue / 1000).toFixed(0)}K` : '—', 
      icon: DollarSign, 
      change: `${stats?.data?.totalTransactions || 0} transactions`, 
      color: 'text-amber-500' 
    },
    { 
      label: 'Trial Users', 
      value: stats?.data?.trialSubscriptions?.toLocaleString('fa-IR') || '—', 
      icon: Clock, 
      change: `${stats?.data?.successfulTransactions || 0} successful payments`, 
      color: 'text-purple-500' 
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="card">
            <div className="flex items-center justify-between mb-4">
              <card.icon className={`w-6 h-6 ${card.color}`} />
              {card.change && (
                <span className={`text-sm font-medium ${card.color}`}>{card.change}</span>
              )}
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
            {domains?.data?.slice(0, 8).map((domain) => (
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
            {(!domains?.data || domains.data.length === 0) && (
              <div className="flex items-center justify-center h-32 text-slate-500">
                <Gamepad2 className="w-8 h-8 mr-2" />
                <span>No gaming domains configured</span>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-4">System Overview</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <span className="text-slate-300">Total Users</span>
              <span className="font-bold text-lg">{stats?.data?.totalUsers || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <span className="text-slate-300">Active Subscriptions</span>
              <span className="font-bold text-lg text-emerald-400">{stats?.data?.activeSubscriptions || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <span className="text-slate-300">Paid Subscriptions</span>
              <span className="font-bold text-lg text-indigo-400">{stats?.data?.totalPaidSubscriptions || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <span className="text-slate-300">Trial Subscriptions</span>
              <span className="font-bold text-lg text-amber-400">{stats?.data?.trialSubscriptions || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <span className="text-slate-300">Users with Registered IP</span>
              <span className="font-bold text-lg text-blue-400">{stats?.data?.usersWithIp || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <span className="text-slate-300">Total Revenue</span>
              <span className="font-bold text-lg text-emerald-400">{stats?.data?.totalRevenue?.toLocaleString('fa-IR') || 0} Toman</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}