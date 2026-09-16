import { Shield, Plus } from 'lucide-react';

export default function ProxyRules() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
      </div>

      <div className="space-y-3">
        {[
          { name: 'Game Traffic', pattern: '/api/game/*', dest: '192.168.1.100', port: 8080, protocol: 'tcp' },
          { name: 'Voice Chat', pattern: '/api/voice/*', dest: '192.168.1.101', port: 443, protocol: 'udp' },
        ].map((rule) => (
          <div key={rule.name} className="card flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Shield className="w-8 h-8 text-amber-500" />
              <div>
                <h3 className="font-medium">{rule.name}</h3>
                <p className="text-sm text-slate-400">
                  {rule.pattern} → {rule.dest}:{rule.port}/{rule.protocol}
                </p>
              </div>
            </div>
            <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-900 text-emerald-300">
              Active
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}