import { Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "./components/Layout";
import Login from "./components/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import ChatReport from "./pages/ChatReport";
import InboxPage from "./pages/Inbox";
import ReceiptsPage from "./pages/Receipts";
import ReceiptDetailPage from "./pages/ReceiptDetail";
import ReviewPage from "./pages/Review";

export default function App() {
  return (
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
  );
}
