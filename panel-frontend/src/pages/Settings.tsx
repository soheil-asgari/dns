import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../store/authStore';

export default function SettingsPage() {
  const { logout } = useAuth();
  const [botToken, setBotToken] = useState('');
  const [originalToken, setOriginalToken] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    api.get('/settings/bot-token').then((res) => {
      setBotToken(res.data.token);
      setOriginalToken(res.data.token);
      setIsConfigured(res.data.isConfigured);
    }).catch(() => showToast('Failed to load settings', 'error'));
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