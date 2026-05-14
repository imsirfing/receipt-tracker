import { signInWithPopup } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth, googleProvider } from "../firebase";
import { LogIn } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      navigate("/");
    } catch (err) {
      console.error("sign-in failed", err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-2xl shadow-lg w-96 text-center">
        <h1 className="text-2xl font-semibold mb-2">Receipt Tracker</h1>
        <p className="text-slate-500 mb-6">Sign in to view your receipts.</p>
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
