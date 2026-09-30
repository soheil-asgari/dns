import { useState, useEffect } from 'react';
import api, { settingsApi } from '../services/api';
import { useAuth } from '../store/authStore';
import { Shield, Plus, X, Link } from 'lucide-react';

export default function SettingsPage() {
  const { logout } = useAuth();
  const [botToken, setBotToken] = useState('');
  const [originalToken, setOriginalToken] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [adminIds, setAdminIds] = useState<number[]>([]);
  const [newAdminId, setNewAdminId] = useState('');
  const [savingAdminIds, setSavingAdminIds] = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    api.get('/settings/bot-token').then((res) => {
      setBotToken(res.data.token);
      setOriginalToken(res.data.token);
      setIsConfigured(res.data.isConfigured);
    }).catch(() => showToast('Failed to load settings', 'error'));

    settingsApi.getBotAdminIds().then((res) => {
      setAdminIds(res.data.adminIds || []);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!botToken.trim()) {
      showToast('Bot token cannot be empty', 'error');
      return;
    }
    setLoading(true);
    try {
      await api.put('/settings/bot-token', { token: botToken });
      setOriginalToken(botToken);
      setIsConfigured(true);
      showToast('Bot token saved successfully', 'success');
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to save bot token', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!botToken.trim()) {
      showToast('Enter a token first', 'error');
      return;
    }
    setTesting(true);
    try {
      const res = await api.post('/settings/bot-token/test', { token: botToken });
      if (res.data.success) {
        showToast(`Connected as @${res.data.botUsername}`, 'success');
      } else {
        showToast(res.data.message || 'Token is invalid', 'error');
      }
    } catch {
      showToast('Test connection failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleAddAdminId = () => {
    const id = parseInt(newAdminId.trim());
    if (isNaN(id) || id <= 0) {
      showToast('Enter a valid Telegram ID', 'error');
      return;
    }
    if (adminIds.includes(id)) {
      showToast('This ID is already in the list', 'error');
      return;
    }
    setAdminIds([...adminIds, id]);
    setNewAdminId('');
  };

  const handleRemoveAdminId = (id: number) => {
    setAdminIds(adminIds.filter(a => a !== id));
  };

  const handleSaveAdminIds = async () => {
    setSavingAdminIds(true);
    try {
      await settingsApi.updateBotAdminIds(adminIds);
      showToast('Bot admin IDs updated successfully. Bot will pick up changes on restart.', 'success');
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to save admin IDs', 'error');
    } finally {
      setSavingAdminIds(false);
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-white text-sm ${
            toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-slate-400 mt-1">Manage system configuration</p>
      </div>

      {/* Bot Token Settings */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold mb-2">Telegram Bot Token</h3>
        <p className="text-sm text-slate-400 mb-4">
          Configure the bot token used for Telegram API communication.
          {isConfigured && <span className="text-emerald-400 ml-2">● Configured</span>}
        </p>

        <div className="space-y-3">
          <input
            type="text"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="Enter bot token..."
          />

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={loading || !botToken.trim() || botToken === originalToken}
              className="btn-primary px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleTest}
              disabled={testing || !botToken.trim()}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </div>
      </div>

      {/* Bot Admin IDs */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <Shield className="w-5 h-5 text-amber-400" />
          Bot Admin Telegram IDs
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          Telegram user IDs listed here can use /postdns and /postnews commands in the bot.
          Find your Telegram ID by messaging <code className="text-indigo-300">@userinfobot</code>.
        </p>

        <div className="space-y-3">
          {/* Current admin IDs */}
          <div className="flex flex-wrap gap-2 mb-3">
            {adminIds.length === 0 && (
              <span className="text-sm text-slate-500">No admin IDs configured. Add one below.</span>
            )}
            {adminIds.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-900/50 text-indigo-300 rounded-lg text-sm font-mono">
                {id}
                <button onClick={() => handleRemoveAdminId(id)} className="hover:text-red-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>

          {/* Add new admin ID */}
          <div className="flex gap-2">
            <input
              type="number"
              value={newAdminId}
              onChange={(e) => setNewAdminId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddAdminId(); }}
              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="Enter Telegram ID (e.g., 123456789)"
            />
            <button
              onClick={handleAddAdminId}
              disabled={!newAdminId.trim()}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>

          <button
            onClick={handleSaveAdminIds}
            disabled={savingAdminIds}
            className="btn-primary px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {savingAdminIds ? 'Saving...' : 'Save Admin IDs'}
          </button>
        </div>
      </div>

      {/* Quick Links */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Link className="w-5 h-5 text-indigo-400" />
          Quick Access
        </h3>
        <div className="flex flex-wrap gap-3">
          <a href="/panel/users" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm">
            👥 User Management
          </a>
          <a href="/panel/bot-admins" className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm">
            🔐 Bot Admin Permissions
          </a>
        </div>
      </div>

      {/* Account Section */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold mb-2">Account</h3>
        <p className="text-sm text-slate-400 mb-4">Manage your admin account</p>
        <button onClick={logout} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">
          Sign Out
        </button>
      </div>
    </div>
  );
}