import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth-context";
import { Inbox, Tag, FileText } from "lucide-react";

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Redirect logged-in users straight to the dashboard
  useEffect(() => {
    if (!loading && user) navigate("/dashboard", { replace: true });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Nav */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-100">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Receipt Tracker" className="w-8 h-8" />
          <span className="font-semibold text-slate-800">Receipt Tracker</span>
        </div>
        <Link
          to="/login"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Sign in →
        </Link>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
        <img src="/logo.png" alt="Receipt Tracker" className="w-20 h-20 mb-6" />
        <h1 className="text-3xl font-bold text-slate-900 mb-4">
          Your receipts, automatically organized
        </h1>
        <p className="text-slate-500 text-lg max-w-md mb-8">
          Receipt Tracker reads your Gmail for purchase confirmations, categorizes your spending,
          and generates reimbursement reports — so you don't have to.
        </p>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-medium text-base"
        >
          Get started with Google
        </Link>

        {/* Features */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-2xl w-full text-left">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <Inbox className="text-indigo-500 mb-3" size={24} />
            <h3 className="font-semibold text-slate-800 mb-1">Auto-import</h3>
            <p className="text-slate-500 text-sm">
              Automatically pulls receipts from your Gmail inbox — no manual uploads.
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <Tag className="text-indigo-500 mb-3" size={24} />
            <h3 className="font-semibold text-slate-800 mb-1">Smart categories</h3>
            <p className="text-slate-500 text-sm">
              Spending is tagged by category so you always know where your money went.
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <FileText className="text-indigo-500 mb-3" size={24} />
            <h3 className="font-semibold text-slate-800 mb-1">Expense reports</h3>
            <p className="text-slate-500 text-sm">
              Generate reimbursement reports instantly, ready to share with your team.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-slate-400 text-sm border-t border-slate-100">
        <Link to="/privacy" className="hover:text-slate-600">Privacy Policy</Link>
      </footer>
    </div>
  );
}
