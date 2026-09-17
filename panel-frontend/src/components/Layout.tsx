import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Globe,
  Gamepad2,
  Shield,
  BarChart3,
  Settings,
} from 'lucide-react';
import { dnsApi } from '../services/api';
import { useDnsStore } from '../store/dnsStore';

const navItems = [
  { to: '/panel', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/panel/dns-records', icon: Globe, label: 'DNS Records' },
  { to: '/panel/gaming-domains', icon: Gamepad2, label: 'Gaming Domains' },
  { to: '/panel/proxy-rules', icon: Shield, label: 'Proxy Rules' },
  { to: '/panel/analytics', icon: BarChart3, label: 'Analytics' },
];

export default function Layout() {
  const { isSyncing, setIsSyncing } = useDnsStore();
  const [syncToast, setSyncToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setSyncToast({ message, type });
    setTimeout(() => setSyncToast(null), 3000);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    showToast('Syncing DNS records to Redis...', 'success');
    try {
      const res = await dnsApi.syncRedis();
      console.log('Sync response:', res.data);
      showToast('DNS data synced to Redis successfully', 'success');
    } catch (err: any) {
      console.error('Sync failed', err);
      showToast(err?.response?.data?.message || 'Sync to Redis failed', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex h-screen">
      {/* Toast */}
      {syncToast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-white text-sm ${
            syncToast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          {syncToast.message}
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 bg-slate-800 border-r border-slate-700">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <Globe className="w-8 h-8 text-indigo-500" />
            <h1 className="text-xl font-bold">DNS Panel</h1>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700'
                  }`
                }
              >
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <header className="bg-slate-800 border-b border-slate-700 px-8 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Dashboard</h2>
            <div className="flex items-center gap-4">
              <button className="btn-primary" onClick={handleSync} disabled={isSyncing}>
                {isSyncing ? 'Syncing...' : 'Sync to Redis'}
              </button>
              <button className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}