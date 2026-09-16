import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';

export default function Analytics() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">DNS Query Volume</h3>
        <div className="flex items-center justify-center h-64 text-slate-500">
          <BarChart3 className="w-12 h-12" />
          <span className="ml-3">Chart placeholder</span>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Cache Hit Ratio</h3>
        <div className="flex items-center justify-center h-64 text-slate-500">
          <div className="text-center">
            <p className="text-4xl font-bold text-emerald-500">87%</p>
            <p className="text-sm text-slate-400 mt-2">Last 24 hours</p>
            <div className="flex items-center justify-center gap-1 mt-2 text-emerald-500">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm">+5% from yesterday</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}