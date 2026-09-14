import { Route, Routes } from 'react-router-dom';
import { Header } from './components/layout/Header';
import { TenderListPage } from './pages/TenderListPage';
import { TenderDetailPage } from './pages/TenderDetailPage';
import { CreateTenderWizard } from './pages/CreateTenderWizard';
import { EvaluatorDashboardPage } from './pages/EvaluatorDashboardPage';
import { PublicAuditPage } from './pages/PublicAuditPage';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <Routes>
        <Route path="/" element={<TenderListPage />} />
        <Route path="/tenders/:id" element={<TenderDetailPage />} />
        <Route path="/create" element={<CreateTenderWizard />} />
        <Route path="/evaluator" element={<EvaluatorDashboardPage />} />
        <Route path="/audit" element={<PublicAuditPage />} />
      </Routes>
    </div>
  );
}
