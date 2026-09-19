import { useState, useEffect } from 'react';
import { Plus, Search, Edit2, Trash2 } from 'lucide-react';
import { dnsApi, DnsRecord } from '../services/api';
import { useDnsStore } from '../store/dnsStore';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'SOA'];

export default function DnsRecords() {
  const { records, setRecords, addRecord, updateRecord, removeRecord } = useDnsStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DnsRecord | null>(null);
  const [form, setForm] = useState({ domain: '', recordType: 'A', value: '', ttl: 3600, isActive: true });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    dnsApi.getRecords()
      .then((res) => setRecords(res.data))
      .catch((err) => {
        console.error('Failed to fetch records', err);
        showToast('Failed to load DNS records', 'error');
      });
  }, [setRecords]);

  const openAddModal = () => {
    setEditingRecord(null);
    setForm({ domain: '', recordType: 'A', value: '', ttl: 3600, isActive: true });
    setIsModalOpen(true);
  };

  const openEditModal = (record: DnsRecord) => {
    setEditingRecord(record);
    setForm({
      domain: record.domain,
      recordType: record.recordType,
      value: record.value,
      ttl: record.ttl,
      isActive: record.isActive,
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.domain || !form.value) {
      showToast('Domain and Value are required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingRecord) {
        const res = await dnsApi.updateRecord(editingRecord.id, form);
        updateRecord(editingRecord.id, res.data);
        showToast('Record updated successfully', 'success');
      } else {
        const res = await dnsApi.createRecord(form);
        addRecord(res.data);
        showToast('Record created successfully', 'success');
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error('Save failed', err);
      showToast(err?.response?.data?.message || 'Failed to save record', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try {
      await dnsApi.deleteRecord(id);
      removeRecord(id);
      showToast('Record deleted', 'success');
    } catch (err: any) {
      console.error('Delete failed', err);
      showToast('Failed to delete record', 'error');
    }
  };

  const filtered = searchTerm
    ? records.filter(
        (r) =>
          r.domain.toLowerCase().includes(searchTerm.toLowerCase()) ||
          r.value.toLowerCase().includes(searchTerm.toLowerCase()) ||
          r.recordType.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : records;

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-white text-sm ${
            toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search records..."
            className="input pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={openAddModal}>
          <Plus className="w-4 h-4" />
          Add Record
        </button>
      </div>

      <div className="card">
        <table className="w-full">
          <thead>
            <tr className="text-left text-slate-400 text-sm border-b border-slate-700">
              <th className="pb-3 font-medium">Domain</th>
              <th className="pb-3 font-medium">Type</th>
              <th className="pb-3 font-medium">Value</th>
              <th className="pb-3 font-medium">TTL</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr className="text-slate-300 border-b border-slate-700/50">
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  No DNS records found. Add your first record to get started.
                </td>
              </tr>
            ) : (
              filtered.map((record) => (
                <tr key={record.id} className="text-slate-300 border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="py-3">{record.domain}</td>
                  <td className="py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-mono bg-slate-700 text-slate-300">
                      {record.recordType}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-sm">{record.value}</td>
                  <td className="py-3 text-sm">{record.ttl}</td>
                  <td className="py-3">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        record.isActive
                          ? 'bg-emerald-900 text-emerald-300'
                          : 'bg-slate-600 text-slate-400'
                      }`}
                    >
                      {record.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <button
                        className="p-1.5 hover:bg-slate-700 rounded transition-colors"
                        onClick={() => openEditModal(record)}
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        className="p-1.5 hover:bg-red-700/50 rounded transition-colors text-red-400"
                        onClick={() => handleDelete(record.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 rounded-xl w-full max-w-lg mx-4 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold mb-4">
              {editingRecord ? 'Edit DNS Record' : 'Add DNS Record'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Domain</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="example.com"
                  value={form.domain}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Type</label>
                  <select
                    className="input w-full"
                    value={form.recordType}
                    onChange={(e) => setForm({ ...form, recordType: e.target.value })}
                  >
                    {RECORD_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">TTL (seconds)</label>
                  <input
                    type="number"
                    className="input w-full"
                    value={form.ttl}
                    onChange={(e) => setForm({ ...form, ttl: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Value</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="192.168.1.1"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  className="rounded border-slate-600 bg-slate-700 text-indigo-600"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <label htmlFor="isActive" className="text-sm text-slate-300">Active</label>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                className="btn-secondary"
                onClick={() => setIsModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}