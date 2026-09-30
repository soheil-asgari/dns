import { useState, useEffect } from 'react';
import { adminApi, UserInfo } from '../services/api';
import { Users, Search, ChevronLeft, ChevronRight, CreditCard, ExternalLink, Clock, CheckCircle, XCircle } from 'lucide-react';

export default function UsersPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [addCreditModal, setAddCreditModal] = useState<{ telegramId: number; days: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [stats, setStats] = useState<any>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getUsers(page, pageSize, search || undefined);
      setUsers(res.data.users);
      setTotal(res.data.total);
    } catch (err: any) {
      showToast('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await adminApi.getStats();
      setStats(res.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchUsers(); }, [page, search]);
  useEffect(() => { fetchStats(); }, []);

  const totalPages = Math.ceil(total / pageSize);

  const handleAddCredit = async (telegramId: number) => {
    if (!addCreditModal) return;
    const days = parseInt(addCreditModal.days);
    if (isNaN(days) || days <= 0) {
      showToast('Days must be a positive number', 'error');
      return;
    }
    try {
      const res = await adminApi.addCredit(telegramId, days);
      showToast(`✅ ${days} days added. New end: ${new Date(res.data.newEndDate).toLocaleDateString('fa-IR')}`, 'success');
      setAddCreditModal(null);
      fetchUsers();
      fetchStats();
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to add credit', 'error');
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('fa-IR');

  const formatPlanType = (type: any): string => {
    if (typeof type === 'number') {
      const enumNames = ['Trial24H', 'PaidMonthly', 'PaidQuarterly', 'PaidYearly'];
      return enumNames[type] || `Paid${type}`;
    }
    if (typeof type === 'string') {
      return type.replace('Paid', '').replace('Trial', 'Trial ').replace('SubscriptionType.', '');
    }
    return String(type);
  };

  const formatRemaining = (remaining: any) => {
    if (!remaining) return '—';
    // .NET TimeSpan serializes as { days, hours, minutes, seconds, totalHours }
    if (typeof remaining === 'object') {
      const days = remaining.days || 0;
      const hours = remaining.hours || 0;
      const totalDays = days + Math.floor(hours / 24);
      const remainingHours = hours % 24;
      if (totalDays > 0) return `${totalDays}d ${remainingHours}h`;
      if (hours > 0) return `${hours}h`;
      if (remaining.totalHours) {
        const h = Math.floor(remaining.totalHours);
        if (h >= 24) return `${Math.floor(h/24)}d ${h%24}h`;
        return `${h}h`;
      }
      return '—';
    }
    // Plain number (seconds)
    if (typeof remaining === 'number') {
      if (remaining <= 0) return 'Expired';
      const days = Math.floor(remaining / 86400);
      const hours = Math.floor((remaining % 86400) / 3600);
      if (days > 0) return `${days}d ${hours}h`;
      return `${hours}h`;
    }
    return '—';
  };

  const statCards = stats ? [
    { label: 'Total Users', value: stats.totalUsers ?? 0, color: 'text-blue-500' },
    { label: 'Active Subs', value: stats.activeSubscriptions ?? 0, color: 'text-emerald-500' },
    { label: 'Paid Users', value: stats.totalPaidSubscriptions ?? 0, color: 'text-indigo-500' },
    { label: 'Users with IP', value: stats.usersWithIp ?? 0, color: 'text-amber-500' },
    { label: 'Revenue (Toman)', value: (stats.totalRevenue ?? 0).toLocaleString('fa-IR'), color: 'text-green-500' },
    { label: 'Transactions', value: (stats.successfulTransactions ?? 0) + '/' + (stats.totalTransactions ?? 0), color: 'text-purple-500' },
  ] : [];

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-white text-sm ${
          toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>{toast.message}</div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((c) => (
          <div key={c.label} className="card p-4">
            <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-slate-400">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by username, name or Telegram ID..."
            className="input pl-10 w-full"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <span className="text-sm text-slate-400">{total} users total</span>
      </div>

      {/* Users Table */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-slate-400 text-sm border-b border-slate-700">
              <th className="pb-3 font-medium">ID / Telegram</th>
              <th className="pb-3 font-medium">User</th>
              <th className="pb-3 font-medium">Plan</th>
              <th className="pb-3 font-medium">Remaining</th>
              <th className="pb-3 font-medium">Registered IP</th>
              <th className="pb-3 font-medium">Purchased</th>
              <th className="pb-3 font-medium">Joined</th>
              <th className="pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="py-8 text-center text-slate-500">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-slate-500">No users found</td></tr>
            ) : (
              users.map((u) => {
                const activeSub = u.activeSubscription as any;
                const remainingTime = activeSub?.remainingTime || 0;
                // remainingTime can be a .NET TimeSpan object { days, hours, minutes } or a number
                const remainingDays = typeof remainingTime === 'object' && remainingTime !== null
                  ? (remainingTime.days || 0) + Math.floor((remainingTime.hours || 0) / 24)
                  : (typeof remainingTime === 'number' ? Math.floor(remainingTime / 86400) : 0);
                return (
                  <tr key={u.id} className="text-slate-300 border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="py-3">
                      <span className="font-mono text-xs">{u.telegramId}</span>
                    </td>
                    <td className="py-3">
                      <div>
                        <span className="font-medium">{(u.firstName || u.username || '—')}</span>
                        {u.username && <span className="text-xs text-slate-500 block">@{u.username}</span>}
                      </div>
                    </td>
                    <td className="py-3">
                      {activeSub ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-900 text-indigo-300">
                          {formatPlanType(activeSub.type)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      {activeSub ? (
                        <span className={`text-sm font-mono ${remainingDays <= 1 ? 'text-red-400' : 'text-emerald-400'}`}>
                          {remainingDays > 0 ? `${remainingDays}d` : formatRemaining(remainingTime)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      <span className="font-mono text-xs">
                        {activeSub?.registeredIp || '—'}
                      </span>
                    </td>
                    <td className="py-3">
                      {u.hasPurchased ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-slate-600" />
                      )}
                    </td>
                    <td className="py-3 text-xs text-slate-400">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedUser(selectedUser?.id === u.id ? null : u)}
                          className="p-1.5 hover:bg-slate-700 rounded transition-colors"
                          title="View Details"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setAddCreditModal({ telegramId: u.telegramId, days: '30' })}
                          className="p-1.5 hover:bg-emerald-700/50 rounded transition-colors text-emerald-400"
                          title="Add Credit"
                        >
                          <CreditCard className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-secondary flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <span className="text-sm text-slate-400">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn-secondary flex items-center gap-1"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* User Detail Panel */}
      {selectedUser && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-500" />
              User Details: {selectedUser.firstName || selectedUser.username || `Telegram #${selectedUser.telegramId}`}
            </h3>
            <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-white">✕</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-slate-400">Telegram ID</p>
              <p className="font-mono">{selectedUser.telegramId}</p>
              {selectedUser.username && (
                <>
                  <p className="text-sm text-slate-400 mt-2">Username</p>
                  <p>@{selectedUser.username}</p>
                </>
              )}
              <p className="text-sm text-slate-400 mt-2">Joined</p>
              <p>{formatDate(selectedUser.createdAt)}</p>
              <p className="text-sm text-slate-400 mt-2">Has Purchased</p>
              <p>{selectedUser.hasPurchased ? '✅ Yes' : '❌ No'}</p>
              <p className="text-sm text-slate-400 mt-2">Active Subscription</p>
              {selectedUser.activeSubscription ? (
                <div className="text-sm">
                  <p>Type: {(selectedUser.activeSubscription as any).type}</p>
                  <p>End: {formatDate((selectedUser.activeSubscription as any).endDate)}</p>
                  <p>IP: {(selectedUser.activeSubscription as any).registeredIp || '—'}</p>
                </div>
              ) : (
                <p className="text-slate-500">No active subscription</p>
              )}
            </div>
            <div>
              <h4 className="font-medium mb-2">Subscription History</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {selectedUser.subscriptions?.length > 0 ? (
                  selectedUser.subscriptions.map((s: any) => (
                    <div key={s.id} className="p-2 bg-slate-700/50 rounded text-sm">
                      <div className="flex justify-between">
                        <span>{formatPlanType(s.type)}</span>
                        <span className={s.isActive && !s.isExpired ? 'text-emerald-400' : 'text-red-400'}>
                          {s.isExpired ? 'Expired' : s.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatDate(s.startDate)} → {formatDate(s.endDate)}
                        {s.registeredIp && <span> | IP: {s.registeredIp}</span>}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500 text-sm">No subscriptions</p>
                )}
              </div>

              <h4 className="font-medium mb-2 mt-4">Payment Transactions</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {selectedUser.transactions?.length > 0 ? (
                  selectedUser.transactions.map((t: any) => (
                    <div key={t.id} className="p-2 bg-slate-700/50 rounded text-sm">
                      <div className="flex justify-between">
                        <span className="text-xs text-slate-400">{t.planTitle}</span>
                        <span className={t.status === 'Success' ? 'text-emerald-400' : t.status === 'Failed' ? 'text-red-400' : 'text-yellow-400'}>
                          {t.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        Amount: {t.amount?.toLocaleString('fa-IR')} Toman
                        {t.refId && <span> | Ref: {t.refId}</span>}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500 text-sm">No transactions</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Credit Modal */}
      {addCreditModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 rounded-xl w-full max-w-md mx-4 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold mb-4">Add Credit Days</h3>
            <p className="text-sm text-slate-400 mb-4">
              Adding days to Telegram ID: <strong>{addCreditModal.telegramId}</strong>
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Days to Add</label>
                <input
                  type="number"
                  className="input w-full"
                  min={1}
                  value={addCreditModal.days}
                  onChange={(e) => setAddCreditModal({ ...addCreditModal, days: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                {[7, 14, 30, 60, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setAddCreditModal({ ...addCreditModal, days: d.toString() })}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      parseInt(addCreditModal.days) === d
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={() => setAddCreditModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => handleAddCredit(addCreditModal.telegramId)}>
                Add Credit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}