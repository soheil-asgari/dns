import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Globe,
  Gamepad2,
  Shield,
  BarChart3,
  Settings,
} from 'lucide-react';

const navItems = [
  { to: '/panel', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/panel/dns-records', icon: Globe, label: 'DNS Records' },
  { to: '/panel/gaming-domains', icon: Gamepad2, label: 'Gaming Domains' },
  { to: '/panel/proxy-rules', icon: Shield, label: 'Proxy Rules' },
  { to: '/panel/analytics', icon: BarChart3, label: 'Analytics' },
];

export default function Layout() {
  return (
    <div className="flex h-screen">
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
              <button className="btn-primary">Sync to Redis</button>
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