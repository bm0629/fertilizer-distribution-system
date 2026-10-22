import { useEffect, useState } from 'react';
import {
  Sprout,
  ShoppingCart,
  Package,
  FileText,
  Wallet,
  ScanLine,
  ShieldCheck,
  Lock,
  History,
  Moon,
  Sun,
  LogOut,
  LogIn,
  Sparkles,
  UserCheck,
  Store,
} from 'lucide-react';
import api, { extractApiErrorMessage, type QrPayload, type UserProfile } from './lib/api';
import { MerchantPosView, type MerchantSection } from './components/MerchantPosView';
import { FarmerCheckoutView, type FarmerSection } from './components/FarmerCheckoutView';

export function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [email, setEmail] = useState<string>('merchant@fds.gov.ph');
  const [password, setPassword] = useState<string>('password123');
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Navigation & Theme State
  const [merchantSection, setMerchantSection] = useState<MerchantSection>('pos');
  const [farmerSection, setFarmerSection] = useState<FarmerSection>('scan');
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // Shared latest QR payload in localStorage so when the user logs out of Merchant and logs in as Farmer (or uses 2 tabs), the QR can be scanned
  const [lastGeneratedQr, setLastGeneratedQr] = useState<QrPayload | null>(() => {
    try {
      const saved = localStorage.getItem('fds_latest_qr_payload');
      return saved ? (JSON.parse(saved) as QrPayload) : null;
    } catch {
      return null;
    }
  });

  // Listen to storage events across browser tabs so a Merchant tab generating a QR immediately updates a Farmer tab!
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'fds_latest_qr_payload' && e.newValue) {
        try {
          setLastGeneratedQr(JSON.parse(e.newValue) as QrPayload);
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleQrGenerated = (payload: QrPayload) => {
    setLastGeneratedQr(payload);
    localStorage.setItem('fds_latest_qr_payload', JSON.stringify(payload));
  };

  const fetchCurrentProfile = async () => {
    const token = localStorage.getItem('fds_auth_token');
    if (!token) return;
    try {
      const res = await api.get('/auth/me');
      setUser(res.data.user);
    } catch {
      localStorage.removeItem('fds_auth_token');
      setUser(null);
    }
  };

  useEffect(() => {
    fetchCurrentProfile();
  }, []);

  const handleLogin = async (targetEmail?: string, targetPassword?: string) => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await api.post('/auth/login', {
        email: targetEmail ?? email,
        password: targetPassword ?? password,
      });
      localStorage.setItem('fds_auth_token', res.data.token);
      setUser(res.data.user);
      if (res.data.user.role === 'merchant') {
        setMerchantSection('pos');
      } else {
        setFarmerSection('scan');
      }
    } catch (err: unknown) {
      setAuthError(extractApiErrorMessage(err, 'Invalid email or password.'));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    localStorage.removeItem('fds_auth_token');
    setUser(null);
  };

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div
        className={`min-h-screen flex flex-col pt-[var(--safe-top)] pb-[var(--safe-bottom)] transition-colors ${
          darkMode ? 'bg-stone-950 text-stone-100' : 'text-stone-900'
        }`}
      >
        {/* Floating Glassmorphic Command Header */}
        <header className="sticky top-0 z-30 px-4 pt-2.5 pb-1.5">
          <div
            className={`max-w-7xl mx-auto rounded-2xl px-4 py-2.5 border shadow-md backdrop-blur-xl transition-colors flex items-center justify-between gap-2 ${
              darkMode
                ? 'bg-stone-900/95 border-stone-800 text-white'
                : 'bg-white/95 border-stone-200/90 text-stone-900'
            }`}
          >
            {/* Brand Identity */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0f2e1d] via-emerald-700 to-amber-500 flex items-center justify-center text-white shadow-xs">
                <Sprout className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-black text-sm tracking-tight text-[#0f2e1d] dark:text-white">
                    AgriVault
                  </span>
                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 text-[9px] font-mono font-bold uppercase">
                    FDS v2.4
                  </span>
                </div>
                <p className="text-[10px] text-stone-500 dark:text-stone-400 hidden xl:block">
                  National Fertilizer Subsidy Ledger
                </p>
              </div>
            </div>

            {/* Center Workspace Section Navigation Pills (Only for the currently authenticated user's role!) */}
            {user && (
              <nav className="flex items-center gap-1 bg-stone-100/90 dark:bg-stone-800 p-1 rounded-2xl border border-stone-200/80 dark:border-stone-700">
                {user.role === 'merchant' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setMerchantSection('pos')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                        merchantSection === 'pos'
                          ? 'bg-[#0f2e1d] text-white shadow-xs'
                          : 'text-stone-600 dark:text-stone-300 hover:bg-stone-200/60'
                      }`}
                    >
                      <ShoppingCart className="w-3.5 h-3.5 text-amber-400" />
                      <span>POS Register</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMerchantSection('inventory')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                        merchantSection === 'inventory'
                          ? 'bg-[#0f2e1d] text-white shadow-xs'
                          : 'text-stone-600 dark:text-stone-300 hover:bg-stone-200/60'
                      }`}
                    >
                      <Package className="w-3.5 h-3.5" />
                      <span>Inventory</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMerchantSection('transactions')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                        merchantSection === 'transactions'
                          ? 'bg-[#0f2e1d] text-white shadow-xs'
                          : 'text-stone-600 dark:text-stone-300 hover:bg-stone-200/60'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Ledger</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMerchantSection('withdrawals')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                        merchantSection === 'withdrawals'
                          ? 'bg-[#0f2e1d] text-white shadow-xs'
                          : 'text-stone-600 dark:text-stone-300 hover:bg-stone-200/60'
                      }`}
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      <span>Payouts (Option C)</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setFarmerSection('scan')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                        farmerSection === 'scan'
                          ? 'bg-[#0f2e1d] text-white shadow-xs'
                          : 'text-stone-600 dark:text-stone-300 hover:bg-stone-200/60'
                      }`}
                    >
                      <ScanLine className="w-3.5 h-3.5 text-amber-400" />
                      <span>1. Scan QR</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFarmerSection('review')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                        farmerSection === 'review'
                          ? 'bg-[#0f2e1d] text-white shadow-xs'
                          : 'text-stone-600 dark:text-stone-300 hover:bg-stone-200/60'
                      }`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>2. Order Review</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFarmerSection('gateway')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                        farmerSection === 'gateway'
                          ? 'bg-[#0f2e1d] text-white shadow-xs'
                          : 'text-stone-600 dark:text-stone-300 hover:bg-stone-200/60'
                      }`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>3. Gateway</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFarmerSection('history')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                        farmerSection === 'history'
                          ? 'bg-[#0f2e1d] text-white shadow-xs'
                          : 'text-stone-600 dark:text-stone-300 hover:bg-stone-200/60'
                      }`}
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>Passbook</span>
                    </button>
                  </>
                )}
              </nav>
            )}

            {/* Right Controls: Authenticated User Profile Badge + Dark Mode + Sign Out */}
            <div className="flex items-center gap-2 shrink-0">
              {user && (
                <div className="hidden md:flex items-center gap-2 pl-2 pr-3 py-1 rounded-xl border border-stone-200/80 dark:border-stone-700 bg-stone-50/80 dark:bg-stone-800">
                  <div className="w-7 h-7 rounded-lg bg-[#0f2e1d] text-amber-300 font-black text-xs flex items-center justify-center shrink-0">
                    {user.role === 'merchant' ? (
                      <Store className="w-3.5 h-3.5" />
                    ) : (
                      <UserCheck className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="text-left">
                    <p className="text-[11px] font-extrabold leading-tight truncate max-w-[140px]">
                      {user.name}
                    </p>
                    <p className="text-[9px] font-mono text-emerald-700 dark:text-emerald-400 uppercase font-bold leading-tight">
                      {user.role === 'merchant'
                        ? 'Merchant'
                        : user.beneficiary_id}
                    </p>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                aria-label="Toggle color theme"
                className="w-8 h-8 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300 hover:bg-stone-100 transition cursor-pointer"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
              </button>

              {user && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/80 dark:bg-red-950/40 flex items-center gap-1.5 text-[11px] font-extrabold text-red-700 dark:text-red-300 hover:bg-red-100 transition cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Main Workspace Container */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5">
          {!user ? (
            <div className="max-w-md mx-auto mt-6">
              <div className="rounded-3xl bg-white dark:bg-stone-900 p-7 shadow-xl border border-stone-200 dark:border-stone-800">
                <div className="flex items-center gap-2.5 text-[#0f2e1d] dark:text-emerald-300 mb-2">
                  <Lock className="w-5 h-5" />
                  <h2 className="text-lg font-black">Role-Scoped Portal Sign In</h2>
                </div>
                <p className="text-xs text-stone-500 mb-5">
                  Sign in with your Accredited Merchant or Registry-Verified Farmer credentials.
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleLogin();
                  }}
                  className="space-y-3.5"
                >
                  <div>
                    <label className="block text-xs font-bold text-stone-600 dark:text-stone-300 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="merchant@fds.gov.ph"
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-3.5 py-2.5 text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-600 dark:text-stone-300 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-3.5 py-2.5 text-xs font-semibold"
                    />
                  </div>

                  {authError && (
                    <p className="text-xs font-semibold text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200">
                      {authError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-3 rounded-2xl bg-[#0f2e1d] hover:bg-emerald-900 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer shadow-md"
                  >
                    <LogIn className="w-4 h-4 text-amber-300" />
                    <span>{authLoading ? 'Authenticating...' : 'Sign In to Portal'}</span>
                  </button>
                </form>

                {/* Seeded Credentials Reference Box on Login Screen */}
                <div className="mt-6 pt-5 border-t border-stone-200 dark:border-stone-800 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>Seeded Assessment Accounts (Click to Autofill)</span>
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setEmail('merchant@fds.gov.ph');
                      setPassword('password123');
                    }}
                    className="w-full p-3 rounded-2xl border border-stone-200 dark:border-stone-800 hover:border-emerald-500 bg-stone-50/70 dark:bg-stone-800/50 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-extrabold">Maria Clara Agro-Supply (Merchant)</p>
                      <p className="text-[11px] font-mono text-stone-500">merchant@fds.gov.ph • password123</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-[10px] font-bold uppercase">
                      Merchant
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEmail('farmer@fds.gov.ph');
                      setPassword('password123');
                    }}
                    className="w-full p-3 rounded-2xl border border-stone-200 dark:border-stone-800 hover:border-amber-500 bg-stone-50/70 dark:bg-stone-800/50 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-extrabold">Juan Dela Cruz (Verified Farmer #1)</p>
                      <p className="text-[11px] font-mono text-stone-500">farmer@fds.gov.ph • RSBSA-03-2026-00142</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-bold uppercase">
                      Farmer
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEmail('farmer2@fds.gov.ph');
                      setPassword('password123');
                    }}
                    className="w-full p-3 rounded-2xl border border-stone-200 dark:border-stone-800 hover:border-stone-400 bg-stone-50/70 dark:bg-stone-800/50 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-extrabold">Pedro Penduko (Verified Farmer #2)</p>
                      <p className="text-[11px] font-mono text-stone-500">farmer2@fds.gov.ph • RSBSA-03-2026-00889</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-stone-200 text-stone-800 text-[10px] font-bold uppercase">
                      Farmer 2
                    </span>
                  </button>
                </div>
              </div>
            </div>
          ) : user.role === 'merchant' ? (
            <MerchantPosView
              merchant={user}
              activeSection={merchantSection}
              onNavigateSection={setMerchantSection}
              onRefreshProfile={fetchCurrentProfile}
              onQrGenerated={handleQrGenerated}
              darkMode={darkMode}
            />
          ) : (
            <FarmerCheckoutView
              farmer={user}
              activeSection={farmerSection}
              onNavigateSection={setFarmerSection}
              lastGeneratedQrPayload={lastGeneratedQr}
              onRefreshProfile={fetchCurrentProfile}
              darkMode={darkMode}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
