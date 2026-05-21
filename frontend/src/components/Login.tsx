import { signInWithPopup, signInWithRedirect } from "firebase/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, googleProvider } from "../firebase";
import { LogIn } from "lucide-react";

// On mobile browsers popups are often blocked; redirect is more reliable.
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const unauthorized = params.get("reason") === "unauthorized";

  const handleSignIn = async () => {
    try {
      if (isMobile) {
        // Redirect flow: navigates away then back; getRedirectResult handles it in AuthProvider.
        await signInWithRedirect(auth, googleProvider);
      } else {
        await signInWithPopup(auth, googleProvider);
        navigate("/");
      }
    } catch (err) {
      console.error("sign-in failed", err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-2xl shadow-lg w-96 text-center">
        <h1 className="text-2xl font-semibold mb-2">Receipt Tracker</h1>
        {unauthorized ? (
          <p className="text-amber-600 text-sm mb-6">That account doesn't have access. Try a different account or contact James.</p>
        ) : (
          <p className="text-slate-500 mb-6">Sign in to view your receipts.</p>
        )}
        <button
          onClick={handleSignIn}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium"
        >
          <LogIn size={18} /> Continue with Google
        </button>
      </div>
    </div>
  );
}
