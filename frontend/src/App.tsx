import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "./components/Layout";
import Login from "./components/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import ReceiptsPage from "./pages/Receipts";
import ReviewPage from "./pages/Review";
import Privacy from "./pages/Privacy";
import Landing from "./pages/Landing";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ChatReport = lazy(() => import("./pages/ChatReport"));
const ReceiptDetailPage = lazy(() => import("./pages/ReceiptDetail"));
const AccessManager = lazy(() => import("./pages/AccessManager"));
const Reports = lazy(() => import("./pages/Reports"));
const PayeeNormalizerPage = lazy(() => import("./pages/PayeeNormalizer"));

export default function App() {
  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center h-screen text-slate-400 text-sm">Loading…</div>}>
        <Routes>
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/receipts" element={<ReceiptsPage />} />
            <Route path="/receipts/:id" element={<ReceiptDetailPage />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/chat" element={<ChatReport />} />
            <Route path="/admin/access" element={<AccessManager />} />
            <Route path="/admin/payees" element={<PayeeNormalizerPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster position="bottom-right" richColors />
    </>
  );
}
