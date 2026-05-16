import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "./components/Layout";
import Login from "./components/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import InboxPage from "./pages/Inbox";
import ReceiptsPage from "./pages/Receipts";
import ReviewPage from "./pages/Review";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ChatReport = lazy(() => import("./pages/ChatReport"));
const ReceiptDetailPage = lazy(() => import("./pages/ReceiptDetail"));

export default function App() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-slate-400 text-sm">Loading…</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/receipts" element={<ReceiptsPage />} />
          <Route path="/receipts/:id" element={<ReceiptDetailPage />} />
          <Route path="/chat" element={<ChatReport />} />
        </Route>
        <Toaster position="bottom-right" richColors />
      </Routes>
    </Suspense>
  );
}
