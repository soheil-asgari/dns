import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import DnsRecords from './pages/DnsRecords';
import GamingDomains from './pages/GamingDomains';
import ProxyRules from './pages/ProxyRules';
import Analytics from './pages/Analytics';

export default function App() {
  return (
    <Routes>
      <Route path="/panel" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="dns-records" element={<DnsRecords />} />
        <Route path="gaming-domains" element={<GamingDomains />} />
        <Route path="proxy-rules" element={<ProxyRules />} />
        <Route path="analytics" element={<Analytics />} />
      </Route>
      <Route path="*" element={<Navigate to="/panel" replace />} />
    </Routes>
  );
}