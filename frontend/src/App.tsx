import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./components/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import ChatReport from "./pages/ChatReport";
import ReceiptsPage from "./pages/Receipts";

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
        <Route path="/receipts" element={<ReceiptsPage />} />
        <Route path="/chat" element={<ChatReport />} />
      </Route>
    </Routes>
  );
}
