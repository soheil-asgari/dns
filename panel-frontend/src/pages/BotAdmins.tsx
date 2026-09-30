import { useState, useEffect } from 'react';
import { adminApi, BotAdmin } from '../services/api';
import { Shield, Plus, Trash2, Save, X } from 'lucide-react';

export default function BotAdminsPage() {
  const [admins, setAdmins] = useState<BotAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<BotAdmin | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'Admin', permissions: 'postdns,postnews' });

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getBotAdmins();
      setAdmins(res.data.admins);
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to load admins', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAdmins(); }, []);

  const handleCreate = async () => {
    if (!form.username || !form.password) {
      showToast('Username and password are required', 'error');
      return;
    }
    try {
      await adminApi.createBotAdmin(form);
      showToast('Admin created successfully', 'success');
      setCreateModal(false);
      setForm({ username: '', password: '', role: 'Admin', permissions: 'postdns,postnews' });
      fetchAdmins();
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to create admin', 'error');
    }
  };

  const handleUpdate = async () => {
    if (!editModal) return;
    try {
      await adminApi.updateBotAdmin(editModal.id, { role: editModal.role, permissions: editModal.permissions });
      showToast('Admin updated successfully', 'success');
      setEditModal(null);
      fetchAdmins();
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to update admin', 'error');
    }
  };

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`Are you sure you want to delete admin "${username}"?`)) return;
    try {
      await adminApi.deleteBotAdmin(id);
      showToast('Admin deleted successfully', 'success');
      fetchAdmins();
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to delete admin', 'error');
    }
  };

  const togglePermission = (admin: BotAdmin, perm: string) => {
    const perms = admin.permissions === 'all' ? ['postdns', 'postnews', 'users'] : admin.permissions.split(',').filter(Boolean);
    const idx = perms.indexOf(perm);
    if (idx >= 0) perms.splice(idx, 1);
    else perms.push(perm);
    const newPerms = perms.length === 0 ? 'none' : perms.join(',');
    setEditModal({ ...admin, permissions: newPerms });
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-white text-sm ${
          toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>{toast.message}</div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Bot Admins</h2>
          <p className="text-slate-400 mt-1">Manage who can use /postdns and /postnews commands</p>
        </div>
        <button onClick={() => setCreateModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Admin
        </button>
      </div>

      {/* Info Card */}
      <div className="bg-indigo-900/20 border border-indigo-700/50 rounded-xl p-4">
        <h4 className="text-sm font-medium text-indigo-300 mb-2">🔒 Permission System</h4>
        <p className="text-xs text-slate-400">
          <strong>postdns</strong> — Access to /postdns command in Telegram<br />
          <strong>postnews</strong> — Access to /postnews command in Telegram<br />
          <strong>users</strong> — Access to user management in this panel<br />
          <strong>all</strong> — Full access (SuperAdmin only)<br /><br />
          Set permissions as comma-separated values: <code className="text-indigo-300">postdns,postnews</code>
        </p>
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-500">Loading...</div>
      ) : admins.length === 0 ? (
        <div className="card text-center py-8 text-slate-500">No admins found. Create one to get started.</div>
      ) : (
        <div className="grid gap-4">
          {admins.map((admin) => (
            <div key={admin.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${admin.role === 'SuperAdmin' ? 'bg-amber-900/50' : 'bg-indigo-900/50'}`}>
                    <Shield className={`w-6 h-6 ${admin.role === 'SuperAdmin' ? 'text-amber-400' : 'text-indigo-400'}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{admin.username}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        admin.role === 'SuperAdmin' ? 'bg-amber-900 text-amber-300' : 'bg-indigo-900 text-indigo-300'
                      }`}>{admin.role}</span>
                      <span className="text-xs text-slate-400">Created: {new Date(admin.createdAt).toLocaleDateString('fa-IR')}</span>
                    </div>
                  </div>
                </div>

                {admin.role !== 'SuperAdmin' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditModal(admin)}
                      className="p-1.5 hover:bg-slate-700 rounded transition-colors"
                      title="Edit Permissions"
                    >
                      <Save className="w-4 h-4 text-indigo-400" />
                    </button>
                    <button
                      onClick={() => handleDelete(admin.id, admin.username)}
                      className="p-1.5 hover:bg-red-700/50 rounded transition-colors text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Permissions */}
              <div className="mt-3 flex flex-wrap gap-2">
                {admin.permissions === 'all' ? (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-900 text-emerald-300">All Permissions</span>
                ) : admin.permissions === 'none' ? (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-slate-700 text-slate-400">No Permissions</span>
                ) : (
                  admin.permissions.split(',').filter(Boolean).map((p) => (
                    <span key={p} className="px-2 py-1 rounded text-xs font-medium bg-slate-700 text-slate-300">
                      {p}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Admin Modal */}
      {createModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 rounded-xl w-full max-w-lg mx-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Create Bot Admin</h3>
              <button onClick={() => setCreateModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Username</label>
                <input type="text" className="input w-full" value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Password</label>
                <input type="password" className="input w-full" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Permissions <span className="text-xs text-slate-500">(comma-separated)</span></label>
                <input type="text" className="input w-full font-mono text-sm"
                  placeholder="postdns,postnews"
                  value={form.permissions}
                  onChange={(e) => setForm({ ...form, permissions: e.target.value })} />
                <p className="text-xs text-slate-500 mt-1">Options: postdns, postnews, users, all</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {['postdns', 'postnews', 'users'].map((p) => {
                  const has = form.permissions.split(',').map(x => x.trim()).includes(p);
                  return (
                    <button key={p} onClick={() => {
                      const perms = form.permissions.split(',').map(x => x.trim()).filter(Boolean);
                      const idx = perms.indexOf(p);
                      if (idx >= 0) perms.splice(idx, 1);
                      else perms.push(p);
                      setForm({ ...form, permissions: perms.join(',') });
                    }} className={`px-3 py-1 rounded text-xs transition-colors ${
                      has ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'
                    }`}>{p}</button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={() => setCreateModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreate}>Create Admin</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Permissions Modal */}
      {editModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 rounded-xl w-full max-w-lg mx-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit: {editModal.username}</h3>
              <button onClick={() => setEditModal(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Role</label>
                <select className="input w-full" value={editModal.role}
                  onChange={(e) => setEditModal({ ...editModal, role: e.target.value })}>
                  <option value="Admin">Admin</option>
                  <option value="SuperAdmin">SuperAdmin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Permissions</label>
                <input type="text" className="input w-full font-mono text-sm" value={editModal.permissions}
                  onChange={(e) => setEditModal({ ...editModal, permissions: e.target.value })} />
              </div>
              <div className="flex gap-2 flex-wrap">
                {['postdns', 'postnews', 'users', 'all'].map((p) => {
                  const perms = editModal.permissions.split(',').map(x => x.trim());
                  const has = perms.includes(p);
                  return (
                    <button key={p} onClick={() => togglePermission(editModal, p)}
                      className={`px-3 py-1 rounded text-xs transition-colors ${
                        has ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'
                      }`}>{p}</button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleUpdate}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}