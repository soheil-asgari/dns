import { useState } from 'react';
import { Plus, Search, Edit2, Trash2 } from 'lucide-react';

export default function DnsRecords() {
  const [searchTerm, setSearchTerm] = useState('');

  return (
    <div className="space-y-4">
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
        <button className="btn-primary flex items-center gap-2">
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
            <tr className="text-slate-300 border-b border-slate-700/50">
              <td colSpan={6} className="py-8 text-center text-slate-500">
                No DNS records found. Add your first record to get started.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}