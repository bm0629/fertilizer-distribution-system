import React, { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  CheckCircle2,
  Loader2,
  XCircle,
  Search,
  ShoppingCart,
  Plus,
  Minus,
  QrCode,
  Wallet,
  ShieldCheck,
  AlertTriangle,
  Download,
  Building2,
  Smartphone,
  RefreshCw,
  Copy,
  Check,
  FileText,
  Edit3,
  Save,
  Sparkles,
  Trash2,
  FlaskConical,
  Layers,
  Receipt,
  ArrowRight,
} from 'lucide-react';
import api, {
  extractApiErrorMessage,
  isRequestCanceled,
  type ProductItem,
  type QrPayload,
  type TransactionRecord,
  type UserProfile,
  type WithdrawalRecord,
} from '../lib/api';
import { StatusBadge } from './StatusBadge';

export type MerchantSection = 'pos' | 'inventory' | 'transactions' | 'withdrawals';

interface MerchantPosViewProps {
  merchant: UserProfile;
  activeSection: MerchantSection;
  onNavigateSection: (section: MerchantSection) => void;
  onRefreshProfile: () => void;
  onQrGenerated: (payload: QrPayload) => void;
  darkMode?: boolean;
}

type BeneficiaryValidationState = 'idle' | 'checking' | 'valid' | 'invalid';

const PAYOUT_FORMAT_HINTS: Record<
  string,
  { method: 'bank_transfer' | 'gcash' | 'maya'; digits: number; regex: RegExp; hint: string; placeholder: string }
> = {
  BDO: {
    method: 'bank_transfer',
    digits: 12,
    regex: /^\d{12}$/,
    hint: 'BDO Unibank requires an exact 12-digit numeric account number.',
    placeholder: '004589123045',
  },
  BPI: {
    method: 'bank_transfer',
    digits: 10,
    regex: /^\d{10}$/,
    hint: 'BPI requires an exact 10-digit numeric account number.',
    placeholder: '1234567890',
  },
  LANDBANK: {
    method: 'bank_transfer',
    digits: 10,
    regex: /^\d{10}$/,
    hint: 'LandBank requires an exact 10-digit numeric account number.',
    placeholder: '3456789012',
  },
  METROBANK: {
    method: 'bank_transfer',
    digits: 13,
    regex: /^\d{13}$/,
    hint: 'Metrobank requires an exact 13-digit numeric account number.',
    placeholder: '1234567890123',
  },
  GCASH: {
    method: 'gcash',
    digits: 11,
    regex: /^09\d{9}$/,
    hint: 'GCash requires an 11-digit PH mobile number starting with 09 (or +639...).',
    placeholder: '09171234567',
  },
  MAYA: {
    method: 'maya',
    digits: 11,
    regex: /^09\d{9}$/,
    hint: 'Maya requires an 11-digit PH mobile number starting with 09 (or +639...).',
    placeholder: '09187654321',
  },
};

export const MerchantPosView: React.FC<MerchantPosViewProps> = ({
  merchant,
  activeSection,
  onNavigateSection,
  onRefreshProfile,
  onQrGenerated,
  darkMode = false,
}) => {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);

  // Debounced Beneficiary ID State Machine: idle -> checking -> valid | invalid
  const [beneficiaryInput, setBeneficiaryInput] = useState<string>('RSBSA-03-2026-00142');
  const [validationState, setValidationState] = useState<BeneficiaryValidationState>('idle');
  const [verifiedFarmer, setVerifiedFarmer] = useState<UserProfile | null>(null);
  const [validationMessage, setValidationMessage] = useState<string>('');
  const lastVerifiedQueryRef = useRef<string>('');

  // Cart State: productId -> quantity
  const [cart, setCart] = useState<Record<number, number>>({});
  const [posSubmitting, setPosSubmitting] = useState<boolean>(false);
  const [posError, setPosError] = useState<string | null>(null);

  // Generated Signed QR Payload State
  const [generatedQr, setGeneratedQr] = useState<QrPayload | null>(null);
  const [generatedTx, setGeneratedTx] = useState<TransactionRecord | null>(null);
  const [copiedQr, setCopiedQr] = useState<boolean>(false);
  const qrCanvasWrapperRef = useRef<HTMLDivElement | null>(null);

  // Inventory Manager State (Edit / Add Product)
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');
  const [editStock, setEditStock] = useState<string>('');
  const [inventoryNotice, setInventoryNotice] = useState<string | null>(null);
  const [showAddProductForm, setShowAddProductForm] = useState<boolean>(false);
  const [newSku, setNewSku] = useState<string>('');
  const [newName, setNewName] = useState<string>('');
  const [newDesc, setNewDesc] = useState<string>('');
  const [newCategory, setNewCategory] = useState<'high_nitrogen' | 'balanced_npk' | 'organic' | 'potash_phosphate'>('balanced_npk');
  const [newNpk, setNewNpk] = useState<string>('16-20-0');
  const [newPrice, setNewPrice] = useState<string>('1550');
  const [newStock, setNewStock] = useState<string>('40');

  // Module 5 Option C: Merchant Payout Withdrawal State
  const [payoutMethod, setPayoutMethod] = useState<'bank_transfer' | 'gcash' | 'maya'>('bank_transfer');
  const [providerName, setProviderName] = useState<string>('BDO');
  const [accountName, setAccountName] = useState<string>('Maria Clara Agro Supply');
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [withdrawAmount, setWithdrawAmount] = useState<string>('2500');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState<boolean>(false);
  const [withdrawFeedback, setWithdrawFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadMerchantData = async () => {
    try {
      const [prodRes, txRes, wdRes] = await Promise.all([
        api.get('/merchant/products'),
        api.get('/merchant/transactions'),
        api.get('/merchant/withdrawals'),
      ]);
      setProducts(prodRes.data.products || []);
      setTransactions(txRes.data.transactions || []);
      setWithdrawals(wdRes.data.withdrawals || []);
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadMerchantData();
  }, [activeSection]);

  // Debounced exact-match Beneficiary ID verification (Module 2 Requirement)
  useEffect(() => {
    const trimmed = beneficiaryInput.trim();

    if (!trimmed) {
      setValidationState('idle');
      setVerifiedFarmer(null);
      setValidationMessage('Enter an official RSBSA Beneficiary ID (exact match required).');
      lastVerifiedQueryRef.current = '';
      return;
    }

    if (trimmed === lastVerifiedQueryRef.current) {
      return;
    }

    setValidationState('checking');
    setValidationMessage('Querying National Farmer Registry...');

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/merchant/beneficiaries/verify', {
          params: { beneficiary_id: trimmed },
          signal: controller.signal,
        });
        lastVerifiedQueryRef.current = trimmed;
        setVerifiedFarmer(res.data.beneficiary);
        setValidationState('valid');
        setValidationMessage('Registry-Verified Beneficiary matched.');
      } catch (err: unknown) {
        if (isRequestCanceled(err)) {
          return;
        }
        lastVerifiedQueryRef.current = trimmed;
        setVerifiedFarmer(null);
        setValidationState('invalid');
        setValidationMessage(
          extractApiErrorMessage(err, 'No farmer matched this exact Beneficiary ID.')
        );
      }
    }, 420);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [beneficiaryInput]);

  // Cart Stepper Controls with boundary constraints (0 to stock_quantity)
  const updateCartQuantity = (product: ProductItem, delta: number) => {
    setPosError(null);
    setCart((prev) => {
      const current = prev[product.id] || 0;
      const next = Math.max(0, Math.min(product.stock_quantity, current + delta));
      const updated = { ...prev };
      if (next === 0) {
        delete updated[product.id];
      } else {
        updated[product.id] = next;
      }
      return updated;
    });
  };

  const cartItems = products
    .filter((p) => (cart[p.id] || 0) > 0)
    .map((p) => ({
      product: p,
      quantity: cart[p.id],
      subtotal: Number(p.unit_price) * cart[p.id],
    }));

  const cartTotal = cartItems.reduce((sum, item) => sum + item.subtotal, 0);
  const totalBagsInCart = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const highNitrogenBagsInCart = cartItems
    .filter((i) => i.product.is_high_nitrogen)
    .reduce((sum, i) => sum + i.quantity, 0);

  const farmerRemainingHighNitrogen =
    verifiedFarmer?.high_nitrogen_quota?.remaining_bags ?? 5;
  const isQuotaExceededInCart = highNitrogenBagsInCart > farmerRemainingHighNitrogen;

  const handleGeneratePosQr = async () => {
    setPosError(null);
    if (validationState !== 'valid' || !verifiedFarmer) {
      setPosError('Please enter and verify a valid Farmer Beneficiary ID before generating a QR request.');
      return;
    }
    if (cartItems.length === 0) {
      setPosError('Please add at least 1 fertilizer bag to the POS cart.');
      return;
    }

    setPosSubmitting(true);
    try {
      const res = await api.post('/merchant/transactions', {
        beneficiary_id: verifiedFarmer.beneficiary_id,
        items: cartItems.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
        })),
      });

      const qrPayload: QrPayload = res.data.qr_payload;
      const tx: TransactionRecord = res.data.transaction;

      setGeneratedQr(qrPayload);
      setGeneratedTx(tx);
      onQrGenerated(qrPayload);
      setCart({});
      await loadMerchantData();
    } catch (err: unknown) {
      setPosError(
        extractApiErrorMessage(err, 'Failed to generate POS transaction.')
      );
    } finally {
      setPosSubmitting(false);
    }
  };

  const handleDownloadQrPng = () => {
    const canvas = qrCanvasWrapperRef.current?.querySelector('canvas');
    if (!canvas || !generatedQr) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `fds-qr-${generatedQr.transaction_uuid.slice(0, 8)}.png`;
    a.click();
  };

  const handleCopyQrJson = () => {
    if (!generatedQr) return;
    navigator.clipboard.writeText(JSON.stringify(generatedQr, null, 2));
    setCopiedQr(true);
    setTimeout(() => setCopiedQr(false), 2000);
  };

  // Inventory Management Handlers
  const startEditingProduct = (p: ProductItem) => {
    setEditingProductId(p.id);
    setEditPrice(String(p.unit_price));
    setEditStock(String(p.stock_quantity));
    setInventoryNotice(null);
  };

  const handleSaveProductEdit = async (productId: number) => {
    try {
      await api.patch(`/merchant/products/${productId}`, {
        unit_price: Number(editPrice),
        stock_quantity: Number(editStock),
      });
      setEditingProductId(null);
      setInventoryNotice('Inventory price and stock updated.');
      await loadMerchantData();
    } catch {
      setInventoryNotice('Failed to update product.');
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setInventoryNotice(null);
    try {
      await api.post('/merchant/products', {
        sku: newSku,
        name: newName,
        description: newDesc,
        category: newCategory,
        npk_ratio: newNpk,
        unit: '50kg Bag',
        unit_price: Number(newPrice),
        stock_quantity: Number(newStock),
      });
      setShowAddProductForm(false);
      setNewSku('');
      setNewName('');
      setNewDesc('');
      setInventoryNotice('New fertilizer product added to active catalog.');
      await loadMerchantData();
    } catch (err: unknown) {
      setInventoryNotice(extractApiErrorMessage(err, 'Failed to create product.'));
    }
  };

  // Module 5 Option C: Real-time client validation check for Merchant Payout
  const currentRule = PAYOUT_FORMAT_HINTS[providerName] || PAYOUT_FORMAT_HINTS.BDO;
  const normalizedAcct = accountNumber.replace(/[\s-]/g, '').replace(/^\+639/, '09');
  const isAccountNumberFormatValid = currentRule.regex.test(normalizedAcct) && !/^(\d)\1+$/.test(normalizedAcct);
  const isAccountNameValid = /^[A-Za-z][A-Za-z\s.\-']+[A-Za-z.]$/.test(accountName.trim()) && accountName.trim().length >= 5;

  const handlePayoutMethodChange = (method: 'bank_transfer' | 'gcash' | 'maya') => {
    setPayoutMethod(method);
    setWithdrawFeedback(null);
    if (method === 'bank_transfer') {
      setProviderName('BDO');
    } else if (method === 'gcash') {
      setProviderName('GCASH');
    } else {
      setProviderName('MAYA');
    }
  };

  const handleWithdrawalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawFeedback(null);
    setWithdrawSubmitting(true);

    try {
      const res = await api.post('/merchant/withdrawals', {
        amount: Number(withdrawAmount),
        payout_method: payoutMethod,
        provider_name: providerName,
        account_name: accountName,
        account_number: accountNumber,
      });

      setWithdrawFeedback({
        type: 'success',
        message: res.data.message,
      });
      setAccountNumber('');
      await loadMerchantData();
      onRefreshProfile();
    } catch (err: unknown) {
      setWithdrawFeedback({
        type: 'error',
        message: extractApiErrorMessage(err, 'Withdrawal request failed validation.'),
      });
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  const cardSurface = darkMode
    ? 'bg-stone-900/90 border-stone-800 text-stone-100'
    : 'bg-white border-stone-200/80 text-stone-900';

  const parseNpkNumbers = (ratio: string) => {
    const parts = ratio.split('-').map((n) => Number(n) || 0);
    return { n: parts[0] || 0, p: parts[1] || 0, k: parts[2] || 0 };
  };

  return (
    <div className="space-y-6">
      {/* Top Executive Bento Telemetry Strip */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Store Identity & Terminal Status (5 cols) */}
        <div className="md:col-span-5 rounded-3xl bg-gradient-to-br from-[#0c2618] via-[#133824] to-[#0a1e13] text-white p-5 shadow-lg border border-emerald-800/40 flex flex-col justify-between relative overflow-hidden">
          <div
            className="absolute -right-8 -bottom-8 w-36 h-36 rounded-full opacity-15 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #34d399 0%, transparent 70%)' }}
          />
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[10px] font-bold uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              Accredited POS Terminal #042
            </span>
            <span className="text-[11px] font-mono text-emerald-300/80">FDS-QR-V1</span>
          </div>
          <div className="mt-3">
            <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">{merchant.store_name || merchant.name}</h2>
            <p className="text-xs text-emerald-200/80 mt-0.5">{merchant.region}</p>
          </div>
        </div>

        {/* Merchant Settlement Wallet Card (4 cols) */}
        <div className={`md:col-span-4 rounded-3xl p-5 border shadow-xs flex flex-col justify-between ${cardSurface}`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Merchant Settlement Wallet
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <p className="text-2xl sm:text-3xl font-black tracking-tight text-emerald-950 dark:text-amber-300">
              ₱{Number(merchant.wallet_balance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </p>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-stone-100 dark:border-stone-800 text-[11px]">
              <span className="text-stone-500">Instant Bank / E-Wallet Payout</span>
              <button
                type="button"
                onClick={() => onNavigateSection('withdrawals')}
                className="font-bold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                <span>Withdraw</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Active Catalog & Ledger Telemetry Card (3 cols) */}
        <div className={`md:col-span-3 rounded-3xl p-5 border shadow-xs flex flex-col justify-between ${cardSurface}`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Stock & Orders
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div className="p-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800/70 border border-stone-200/60 dark:border-stone-700">
              <p className="text-lg font-black">{products.reduce((s, p) => s + p.stock_quantity, 0)}</p>
              <p className="text-[10px] text-stone-500 font-semibold uppercase">Total Bags</p>
            </div>
            <div className="p-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800/70 border border-stone-200/60 dark:border-stone-700">
              <p className="text-lg font-black">{transactions.length}</p>
              <p className="text-[10px] text-stone-500 font-semibold uppercase">POS Orders</p>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: 2-COLUMN SPLIT POS REGISTER TERMINAL */}
      {activeSection === 'pos' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT 8 COLUMNS: Debounced Beneficiary Verifier + Fertilizer Nutrient Grid */}
          <div className="lg:col-span-8 space-y-5">
            {/* Step 1: Debounced Exact-Match Beneficiary Verification Card */}
            <div className={`rounded-3xl p-5 sm:p-6 shadow-xs border ${cardSurface}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-900 text-amber-300 font-black text-xs flex items-center justify-center">
                    01
                  </div>
                  <div>
                    <label
                      htmlFor="beneficiary-id-input"
                      className="text-xs font-extrabold uppercase tracking-wider block"
                    >
                      Beneficiary Identity Verification
                    </label>
                    <p className="text-[11px] text-stone-500">
                      Exact-match lookup against the National Farmer Registry (420ms debounce)
                    </p>
                  </div>
                </div>

                {/* 4-State Visual Pipeline Pill (idle -> checking -> valid | invalid) */}
                <div
                  data-testid="beneficiary-validation-state"
                  className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-1 rounded-xl border border-stone-200 dark:border-stone-700 text-[10px] font-bold uppercase tracking-wider"
                >
                  <span
                    className={`px-2 py-0.5 rounded-lg transition ${
                      validationState === 'idle'
                        ? 'bg-stone-700 text-white'
                        : 'text-stone-400'
                    }`}
                  >
                    Idle
                  </span>
                  <span className="text-stone-300">➔</span>
                  <span
                    className={`px-2 py-0.5 rounded-lg flex items-center gap-1 transition ${
                      validationState === 'checking'
                        ? 'bg-amber-400 text-stone-950 shadow-2xs'
                        : 'text-stone-400'
                    }`}
                  >
                    {validationState === 'checking' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                    Checking
                  </span>
                  <span className="text-stone-300">➔</span>
                  <span
                    className={`px-2 py-0.5 rounded-lg flex items-center gap-1 transition ${
                      validationState === 'valid'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-stone-400'
                    }`}
                  >
                    {validationState === 'valid' && <CheckCircle2 className="w-2.5 h-2.5" />}
                    Valid
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-lg flex items-center gap-1 transition ${
                      validationState === 'invalid'
                        ? 'bg-red-600 text-white shadow-2xs'
                        : 'text-stone-400'
                    }`}
                  >
                    {validationState === 'invalid' && <XCircle className="w-2.5 h-2.5" />}
                    Invalid
                  </span>
                </div>
              </div>

              {/* Search Input Box */}
              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="beneficiary-id-input"
                  type="text"
                  value={beneficiaryInput}
                  onChange={(e) => setBeneficiaryInput(e.target.value)}
                  placeholder="Enter exact RSBSA ID (e.g., RSBSA-03-2026-00142)"
                  className={`w-full rounded-2xl border pl-10 pr-4 py-3 text-sm font-mono font-bold transition focus:outline-none focus:ring-2 ${
                    validationState === 'valid'
                      ? 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20 text-emerald-950 dark:text-emerald-200 focus:ring-emerald-500'
                      : validationState === 'invalid'
                      ? 'border-red-400 bg-red-50/30 dark:bg-red-950/20 text-red-950 dark:text-red-200 focus:ring-red-500'
                      : 'border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-white focus:ring-emerald-600'
                  }`}
                />
              </div>

              {/* Quick Preset Pills for Demo Testing */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-[11px]">
                <span className="text-stone-400 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  Demo Presets:
                </span>
                <button
                  type="button"
                  onClick={() => setBeneficiaryInput('RSBSA-03-2026-00142')}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 font-mono font-semibold cursor-pointer transition"
                >
                  RSBSA-03-2026-00142 (Juan • ₱15k)
                </button>
                <button
                  type="button"
                  onClick={() => setBeneficiaryInput('RSBSA-03-2026-00889')}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 font-mono font-semibold cursor-pointer transition"
                >
                  RSBSA-03-2026-00889 (Pedro • ₱12.5k)
                </button>
                <button
                  type="button"
                  onClick={() => setBeneficiaryInput('RSBSA-INVALID-999')}
                  className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/50 hover:bg-red-100 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800 font-mono font-semibold cursor-pointer transition"
                >
                  RSBSA-INVALID-999 (Invalid Test)
                </button>
              </div>

              {/* Verified Beneficiary Digital Pass Banner */}
              <div className="mt-3.5">
                {validationState === 'valid' && verifiedFarmer ? (
                  <div className="rounded-2xl bg-gradient-to-r from-emerald-950 via-[#123522] to-stone-900 text-white p-4 border border-emerald-700/50 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center font-black text-base text-emerald-300 shrink-0">
                        {verifiedFarmer.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-sm">{verifiedFarmer.name}</h4>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/25 text-emerald-200 text-[10px] font-mono font-bold">
                            VERIFIED RSBSA
                          </span>
                        </div>
                        <p className="text-[11px] text-emerald-200/80 mt-0.5">
                          {verifiedFarmer.beneficiary_id} • {verifiedFarmer.region}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/10">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-emerald-300/80 font-semibold">
                          High-Nitrogen Quota
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          {[1, 2, 3, 4, 5].map((bagIdx) => {
                            const used = verifiedFarmer.high_nitrogen_quota?.used_bags ?? 0;
                            const isUsed = bagIdx <= used;
                            const isSelectedNow =
                              !isUsed && bagIdx <= used + highNitrogenBagsInCart;
                            return (
                              <span
                                key={bagIdx}
                                className={`w-4 h-2 rounded-xs transition ${
                                  isUsed
                                    ? 'bg-stone-500'
                                    : isSelectedNow
                                    ? 'bg-amber-400 shadow-[0_0_6px_#fbbf24]'
                                    : 'bg-emerald-400'
                                }`}
                              />
                            );
                          })}
                          <span className="text-xs font-bold ml-1">
                            {verifiedFarmer.high_nitrogen_quota?.remaining_bags ?? 5}/5 left
                          </span>
                        </div>
                      </div>

                      <div className="text-right pl-4 border-l border-white/15">
                        <p className="text-[10px] uppercase tracking-wider text-emerald-300/80 font-semibold">
                          Subsidy Allocation
                        </p>
                        <p className="text-base font-black text-amber-300">
                          ₱{Number(verifiedFarmer.subsidy_balance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`p-3 rounded-2xl border text-xs font-semibold flex items-center gap-2 ${
                      validationState === 'invalid'
                        ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
                        : validationState === 'checking'
                        ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 text-amber-800 dark:text-amber-300'
                        : 'bg-stone-50 dark:bg-stone-800 border-stone-200 text-stone-500'
                    }`}
                  >
                    {validationState === 'invalid' && <XCircle className="w-4 h-4 shrink-0" />}
                    {validationState === 'checking' && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
                    <span>{validationMessage}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Subsidized Fertilizer Catalog with NPK Nutrient Bars & Boundary Steppers */}
            <div className={`rounded-3xl p-5 sm:p-6 shadow-xs border ${cardSurface}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-900 text-amber-300 font-black text-xs flex items-center justify-center">
                    02
                  </div>
                  <div>
                    <h3 className="text-xs font-extrabold uppercase tracking-wider">
                      Accredited Fertilizer Catalog & Boundary Steppers
                    </h3>
                    <p className="text-[11px] text-stone-500">
                      Steppers automatically lock at 0 and at available warehouse stock boundaries
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-400/30 text-[11px] font-bold">
                  Season Limit: Max 5 High-N Bags
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {products.map((product) => {
                  const qty = cart[product.id] || 0;
                  const atMinBoundary = qty <= 0;
                  const atMaxBoundary = qty >= product.stock_quantity;
                  const npk = parseNpkNumbers(product.npk_ratio);
                  const lowStock = product.stock_quantity <= 10;

                  return (
                    <div
                      key={product.id}
                      className={`group rounded-2xl border p-4 transition-all duration-200 flex flex-col justify-between relative overflow-hidden ${
                        qty > 0
                          ? 'border-emerald-600 bg-emerald-50/35 dark:bg-emerald-950/30 shadow-md ring-1 ring-emerald-500/30'
                          : 'border-stone-200/90 dark:border-stone-800 bg-stone-50/40 dark:bg-stone-900/40 hover:border-stone-300'
                      }`}
                    >
                      <div>
                        {/* Top SKU & Category Badges */}
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                              product.is_high_nitrogen
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                            }`}
                          >
                            <FlaskConical className="w-3 h-3" />
                            {product.is_high_nitrogen ? `High-Nitrogen (${product.npk_ratio})` : `NPK ${product.npk_ratio}`}
                          </span>

                          <span
                            className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-md ${
                              lowStock
                                ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                : 'bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
                            }`}
                          >
                            {product.stock_quantity} in stock
                          </span>
                        </div>

                        <h4 className="font-extrabold text-sm mt-2.5 leading-snug">{product.name}</h4>
                        <p className="text-[11px] text-stone-500 dark:text-stone-400 line-clamp-2 mt-1">
                          {product.description}
                        </p>

                        {/* Visual NPK Nutrient Composition Mini-Pills */}
                        <div className="grid grid-cols-3 gap-1.5 mt-3 pt-2.5 border-t border-stone-200/60 dark:border-stone-800 text-[10px]">
                          <div className="bg-white/80 dark:bg-stone-800/80 rounded-lg px-2 py-1 border border-stone-200/60 dark:border-stone-700 flex items-center justify-between">
                            <span className="font-bold text-emerald-700 dark:text-emerald-400">N</span>
                            <span className="font-mono font-extrabold">{npk.n}%</span>
                          </div>
                          <div className="bg-white/80 dark:bg-stone-800/80 rounded-lg px-2 py-1 border border-stone-200/60 dark:border-stone-700 flex items-center justify-between">
                            <span className="font-bold text-amber-700 dark:text-amber-400">P</span>
                            <span className="font-mono font-extrabold">{npk.p}%</span>
                          </div>
                          <div className="bg-white/80 dark:bg-stone-800/80 rounded-lg px-2 py-1 border border-stone-200/60 dark:border-stone-700 flex items-center justify-between">
                            <span className="font-bold text-teal-700 dark:text-teal-400">K</span>
                            <span className="font-mono font-extrabold">{npk.k}%</span>
                          </div>
                        </div>
                      </div>

                      {/* Price & Tactile Boundary Stepper */}
                      <div className="mt-4 pt-3 border-t border-stone-200/80 dark:border-stone-800 flex items-center justify-between">
                        <div>
                          <p className="text-base font-black text-emerald-950 dark:text-amber-300">
                            ₱{Number(product.unit_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </p>
                          <p className="text-[10px] text-stone-500 font-medium">per {product.unit}</p>
                        </div>

                        <div className="flex items-center gap-1.5 bg-white dark:bg-stone-800 rounded-2xl border border-stone-300 dark:border-stone-700 p-1 shadow-2xs">
                          <button
                            type="button"
                            aria-label={`Decrease ${product.name}`}
                            disabled={atMinBoundary}
                            onClick={() => updateCartQuantity(product, -1)}
                            className="w-8 h-8 rounded-xl flex items-center justify-center bg-stone-100 dark:bg-stone-700 text-stone-800 dark:text-stone-200 hover:bg-stone-200 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>

                          <span
                            data-testid={`stepper-qty-${product.sku}`}
                            className="w-8 text-center font-mono text-xs font-black"
                          >
                            {qty}
                          </span>

                          <button
                            type="button"
                            aria-label={`Increase ${product.name}`}
                            disabled={atMaxBoundary}
                            onClick={() => updateCartQuantity(product, 1)}
                            className="w-8 h-8 rounded-xl flex items-center justify-center bg-[#0f2e1d] text-white hover:bg-emerald-800 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT 4 COLUMNS: STICKY LIVE POS RECEIPT REGISTER & CRYPTOGRAPHIC QR GENERATOR */}
          <div className="lg:col-span-4 lg:sticky lg:top-24 space-y-5">
            <div className={`rounded-3xl border shadow-lg overflow-hidden ${cardSurface}`}>
              {/* Register Receipt Top Header */}
              <div className="bg-[#0f2e1d] text-white p-5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center">
                    <Receipt className="w-4 h-4 text-amber-300" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold">Live Order Ticket</h3>
                    <p className="text-[11px] text-emerald-300/80">
                      {verifiedFarmer ? verifiedFarmer.beneficiary_id : 'Awaiting Beneficiary'}
                    </p>
                  </div>
                </div>

                {cartItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart({})}
                    title="Clear Cart"
                    className="p-2 rounded-xl bg-white/10 hover:bg-red-500/30 text-emerald-200 hover:text-red-200 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="p-5 space-y-4">
                {/* Line Items List */}
                {cartItems.length === 0 ? (
                  <div className="py-10 text-center space-y-2 border-2 border-dashed border-stone-200 dark:border-stone-800 rounded-2xl">
                    <ShoppingCart className="w-7 h-7 text-stone-400 mx-auto" />
                    <p className="text-xs font-bold text-stone-500">POS Register Cart is Empty</p>
                    <p className="text-[11px] text-stone-400 px-6">
                      Use the <code className="font-bold">+</code> steppers on the left to add fertilizer bags to this order.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                    {cartItems.map(({ product, quantity, subtotal }) => (
                      <div
                        key={product.id}
                        className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-800/60 border border-stone-200/70 dark:border-stone-700 flex items-center justify-between text-xs"
                      >
                        <div>
                          <p className="font-bold leading-snug">{product.name}</p>
                          <p className="text-[11px] text-stone-500 font-mono mt-0.5">
                            {quantity} × ₱{Number(product.unit_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                        <p className="font-mono font-extrabold text-sm">
                          ₱{subtotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* High-Nitrogen Quota Meter (Module 5 Option A) */}
                <div
                  className={`p-3.5 rounded-2xl border text-xs transition ${
                    isQuotaExceededInCart
                      ? 'bg-red-50 dark:bg-red-950/40 border-red-300 text-red-900 dark:text-red-200'
                      : 'bg-stone-50 dark:bg-stone-800/50 border-stone-200 dark:border-stone-700'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle
                        className={`w-3.5 h-3.5 ${
                          isQuotaExceededInCart ? 'text-red-600' : 'text-amber-600'
                        }`}
                      />
                      <span>High-Nitrogen Quota (Option A)</span>
                    </span>
                    <span className="font-mono">
                      {highNitrogenBagsInCart} / {farmerRemainingHighNitrogen} bags
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isQuotaExceededInCart ? 'bg-red-600' : 'bg-amber-500'
                      }`}
                      style={{
                        width: `${Math.min(100, (highNitrogenBagsInCart / Math.max(1, farmerRemainingHighNitrogen)) * 100)}%`,
                      }}
                    />
                  </div>
                  {isQuotaExceededInCart && (
                    <p className="text-[11px] text-red-700 dark:text-red-300 font-semibold mt-1.5">
                      Exceeds 5-bag seasonal High-Nitrogen limit! Server will reject this order if submitted.
                    </p>
                  )}
                </div>

                {/* Totals Breakdown */}
                <div className="pt-3 border-t border-dashed border-stone-300 dark:border-stone-700 space-y-1.5 text-xs">
                  <div className="flex justify-between text-stone-500">
                    <span>Selected Fertilizer Volume</span>
                    <span className="font-mono font-bold">{totalBagsInCart} bag(s)</span>
                  </div>
                  <div className="flex justify-between text-stone-500">
                    <span>Cryptographic Protocol</span>
                    <span className="font-mono">HMAC-SHA256 • 15m TTL</span>
                  </div>
                  <div className="flex justify-between items-baseline pt-2">
                    <span className="font-extrabold uppercase tracking-wider text-stone-700 dark:text-stone-300">
                      Total Payable
                    </span>
                    <span className="text-2xl font-black text-emerald-950 dark:text-amber-300">
                      ₱{cartTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {posError && (
                  <div className="p-3.5 rounded-2xl bg-red-50 border border-red-300 text-red-900 text-xs font-semibold flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                    <span>{posError}</span>
                  </div>
                )}

                <button
                  type="button"
                  disabled={posSubmitting || cartItems.length === 0 || validationState !== 'valid'}
                  onClick={handleGeneratePosQr}
                  className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-[#0f2e1d] to-emerald-800 hover:from-emerald-900 hover:to-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  {posSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <QrCode className="w-4 h-4 text-amber-300" />
                  )}
                  <span>Generate Signed Payment QR</span>
                </button>
              </div>
            </div>

            {/* Generated Dynamic Signed QR Card (Appears right below ticket) */}
            {generatedQr && generatedTx && (
              <div className="rounded-3xl bg-gradient-to-b from-[#0c2618] to-stone-950 text-white p-5 shadow-xl border border-emerald-500/40 space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    <div>
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-300">
                        Signed QR Token Ready
                      </h3>
                      <p className="text-[11px] text-stone-300">
                        Scan on Farmer device or 1-Click Handoff
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={generatedTx.status} size="sm" />
                </div>

                <div
                  ref={qrCanvasWrapperRef}
                  className="bg-white p-4 rounded-2xl flex flex-col items-center justify-center mx-auto shadow-lg w-fit"
                >
                  <QRCodeCanvas
                    value={JSON.stringify(generatedQr)}
                    size={185}
                    level="M"
                    includeMargin={true}
                  />
                  <p className="text-xs font-mono font-black text-stone-900 mt-1">
                    ₱{Number(generatedQr.total_amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                </div>

                <div className="space-y-2 text-[11px]">
                  <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
                    <p className="text-[9px] uppercase tracking-wider text-emerald-300 font-bold">
                      Composite Reference (BeneficiaryID|UUID|Timestamp)
                    </p>
                    <p className="font-mono break-all text-white mt-0.5">
                      {generatedQr.reference_string}
                    </p>
                  </div>

                  <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
                    <p className="text-[9px] uppercase tracking-wider text-emerald-300 font-bold">
                      HMAC-SHA256 Signature
                    </p>
                    <p className="font-mono break-all text-amber-300 mt-0.5">
                      {generatedQr.signature.slice(0, 36)}...
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleDownloadQrPng}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Save PNG</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyQrJson}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition cursor-pointer"
                    >
                      {copiedQr ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedQr ? 'Copied!' : 'Copy JSON'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 2: PRODUCTS & INVENTORY MANAGER */}
      {activeSection === 'inventory' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                Warehouse & Stock Control
              </p>
              <h2 className="text-xl font-extrabold text-[#143321] dark:text-white">
                Manage Accredited Fertilizer Catalog & Stock Quantities
              </h2>
            </div>

            <button
              type="button"
              onClick={() => setShowAddProductForm(!showAddProductForm)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-[#0f2e1d] text-white text-xs font-bold hover:bg-emerald-900 transition cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4 text-amber-300" />
              <span>{showAddProductForm ? 'Close SKU Form' : 'Add Fertilizer SKU'}</span>
            </button>
          </div>

          {inventoryNotice && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              <span>{inventoryNotice}</span>
            </div>
          )}

          {showAddProductForm && (
            <form
              onSubmit={handleCreateProduct}
              className={`rounded-3xl p-6 border shadow-xs space-y-4 ${cardSurface}`}
            >
              <h3 className="text-sm font-extrabold">Register New Fertilizer SKU</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-xs">
                <div>
                  <label className="block font-bold mb-1">SKU Code</label>
                  <input
                    required
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    placeholder="FERT-NPK-16200"
                    className="w-full rounded-xl border border-stone-300 px-3 py-2.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Product Name</label>
                  <input
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ammonium Phosphate (16-20-0)"
                    className="w-full rounded-xl border border-stone-300 px-3 py-2.5"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Subsidy Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) =>
                      setNewCategory(
                        e.target.value as 'high_nitrogen' | 'balanced_npk' | 'organic' | 'potash_phosphate'
                      )
                    }
                    className="w-full rounded-xl border border-stone-300 px-3 py-2.5"
                  >
                    <option value="balanced_npk">Balanced NPK</option>
                    <option value="high_nitrogen">High-Nitrogen (5-Bag Quota Tracked)</option>
                    <option value="potash_phosphate">Potash / Phosphate</option>
                    <option value="organic">Organic Blend</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">NPK Analysis Ratio</label>
                  <input
                    required
                    value={newNpk}
                    onChange={(e) => setNewNpk(e.target.value)}
                    placeholder="16-20-0"
                    className="w-full rounded-xl border border-stone-300 px-3 py-2.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Unit Price (PHP)</label>
                  <input
                    required
                    type="number"
                    min="1"
                    step="0.01"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 px-3 py-2.5"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Initial Stock (50kg Bags)</label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={newStock}
                    onChange={(e) => setNewStock(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 px-3 py-2.5"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-emerald-800 text-white text-xs font-bold hover:bg-emerald-900 cursor-pointer"
              >
                Save Fertilizer SKU
              </button>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((p) => (
              <div
                key={p.id}
                className={`rounded-3xl p-5 border shadow-2xs flex flex-col justify-between ${cardSurface}`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-stone-400">{p.sku}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                        p.is_high_nitrogen
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-emerald-100 text-emerald-900'
                      }`}
                    >
                      NPK {p.npk_ratio}
                    </span>
                  </div>
                  <h4 className="font-extrabold text-base mt-2">{p.name}</h4>
                  <p className="text-xs text-stone-500 mt-1">{p.description}</p>
                </div>

                {editingProductId === p.id ? (
                  <div className="mt-4 pt-3 border-t border-stone-200 dark:border-stone-800 flex items-end justify-between gap-2 text-xs">
                    <div>
                      <label className="block text-[10px] text-stone-500 font-bold">Unit Price (₱)</label>
                      <input
                        type="number"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-24 rounded-xl border border-stone-300 px-2.5 py-1.5 font-mono font-bold mt-0.5"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-stone-500 font-bold">Stock Bags</label>
                      <input
                        type="number"
                        value={editStock}
                        onChange={(e) => setEditStock(e.target.value)}
                        className="w-20 rounded-xl border border-stone-300 px-2.5 py-1.5 font-mono font-bold mt-0.5"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSaveProductEdit(p.id)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-700 text-white font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Save</span>
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 pt-3 border-t border-stone-200/80 dark:border-stone-800 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase text-stone-400 font-bold">Unit Price</p>
                      <p className="font-black text-base text-emerald-950 dark:text-amber-300">
                        ₱{Number(p.unit_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-stone-400 font-bold">Warehouse Stock</p>
                      <p className="font-mono font-black text-base">{p.stock_quantity} bags</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEditingProduct(p)}
                      className="p-2.5 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-emerald-100 dark:hover:bg-stone-700 transition cursor-pointer"
                      title="Edit price & stock"
                    >
                      <Edit3 className="w-4 h-4 text-stone-700 dark:text-stone-200" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 3: TRANSACTIONS LEDGER */}
      {activeSection === 'transactions' && (
        <div className={`rounded-3xl p-6 shadow-xs border ${cardSurface}`}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                Cryptographic Audit Ledger
              </p>
              <h3 className="text-lg font-extrabold">
                POS Transactions & Settlement Status
              </h3>
            </div>
            <button
              type="button"
              onClick={loadMerchantData}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-xs font-bold hover:bg-stone-200 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Ledger</span>
            </button>
          </div>

          {transactions.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <FileText className="w-8 h-8 text-stone-400 mx-auto" />
              <p className="text-xs font-bold text-stone-500">No POS transactions recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-4 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-xs font-black">{tx.beneficiary_id}</span>
                      <StatusBadge status={tx.status} size="sm" />
                    </div>
                    <p className="text-[11px] font-mono text-stone-500 mt-1">
                      Composite Ref: {tx.reference_string}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-black text-emerald-950 dark:text-amber-300">
                      ₱{Number(tx.total_amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-[11px] text-stone-500">
                      {tx.items?.length || 0} fertilizer item(s)
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 4: WITHDRAWALS & STRICT PAYOUT VALIDATOR (Module 5 Option C) */}
      {activeSection === 'withdrawals' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className={`lg:col-span-7 rounded-3xl p-6 shadow-xs border ${cardSurface}`}>
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
              Module 5 • Option C Extension
            </p>
            <h3 className="text-lg font-extrabold flex items-center gap-2 mt-0.5">
              <Wallet className="w-5 h-5 text-emerald-700" />
              <span>Merchant Earnings Payout & Strict Format Validator</span>
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              Validates institution-specific account digit lengths, mobile prefixes, and anti-placeholder checksums before disbursing funds.
            </p>

            <form onSubmit={handleWithdrawalSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => handlePayoutMethodChange('bank_transfer')}
                  className={`py-3 px-3 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    payoutMethod === 'bank_transfer'
                      ? 'bg-[#0f2e1d] text-white border-[#0f2e1d] shadow-xs'
                      : 'bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-200 border-stone-200 dark:border-stone-700'
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span>Bank Transfer</span>
                </button>

                <button
                  type="button"
                  onClick={() => handlePayoutMethodChange('gcash')}
                  className={`py-3 px-3 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    payoutMethod === 'gcash'
                      ? 'bg-[#0f2e1d] text-white border-[#0f2e1d] shadow-xs'
                      : 'bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-200 border-stone-200 dark:border-stone-700'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>GCash Wallet</span>
                </button>

                <button
                  type="button"
                  onClick={() => handlePayoutMethodChange('maya')}
                  className={`py-3 px-3 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    payoutMethod === 'maya'
                      ? 'bg-[#0f2e1d] text-white border-[#0f2e1d] shadow-xs'
                      : 'bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-200 border-stone-200 dark:border-stone-700'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Maya Wallet</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-stone-600 dark:text-stone-300 mb-1">
                    Receiving Institution / Provider
                  </label>
                  <select
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                    disabled={payoutMethod !== 'bank_transfer'}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 px-3.5 py-2.5 text-xs font-bold"
                  >
                    {payoutMethod === 'bank_transfer' ? (
                      <>
                        <option value="BDO">BDO Unibank (12 Digits)</option>
                        <option value="BPI">BPI (10 Digits)</option>
                        <option value="LANDBANK">LandBank (10 Digits)</option>
                        <option value="METROBANK">Metrobank (13 Digits)</option>
                      </>
                    ) : payoutMethod === 'gcash' ? (
                      <option value="GCASH">GCash Mobile (09XXXXXXXXX)</option>
                    ) : (
                      <option value="MAYA">Maya Mobile (09XXXXXXXXX)</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-600 dark:text-stone-300 mb-1">
                    Payout Amount (PHP) • Min ₱500.00
                  </label>
                  <input
                    type="number"
                    min="500"
                    step="0.01"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 px-3.5 py-2.5 text-xs font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-stone-600 dark:text-stone-300 mb-1">
                    Account Holder Name
                  </label>
                  <input
                    type="text"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="e.g., Maria Clara Agro Supply"
                    className={`w-full rounded-xl border px-3.5 py-2.5 text-xs font-semibold ${
                      isAccountNameValid ? 'border-emerald-500 bg-emerald-50/20' : 'border-red-400 bg-red-50/20'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-600 dark:text-stone-300 mb-1">
                    {payoutMethod === 'bank_transfer' ? 'Bank Account Number' : 'PH Mobile Wallet Number'}
                  </label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder={currentRule.placeholder}
                    className={`w-full rounded-xl border px-3.5 py-2.5 text-xs font-mono font-bold ${
                      accountNumber.length === 0
                        ? 'border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800'
                        : isAccountNumberFormatValid
                        ? 'border-emerald-500 bg-emerald-50/30 text-emerald-950 dark:text-emerald-200'
                        : 'border-red-400 bg-red-50/30 text-red-900 dark:text-red-200'
                    }`}
                  />
                  <p className="text-[11px] text-stone-500 mt-1">{currentRule.hint}</p>
                </div>
              </div>

              <button
                type="submit"
                disabled={withdrawSubmitting}
                className="w-full py-3.5 rounded-2xl bg-[#0f2e1d] hover:bg-emerald-900 text-white font-extrabold text-xs uppercase tracking-wider transition cursor-pointer shadow-md"
              >
                {withdrawSubmitting ? 'Validating & Disbursing...' : 'Validate & Disburse Payout'}
              </button>
            </form>

            {withdrawFeedback && (
              <div
                className={`mt-4 p-3.5 rounded-2xl border text-xs font-semibold ${
                  withdrawFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : 'bg-red-50 border-red-300 text-red-900'
                }`}
              >
                {withdrawFeedback.message}
              </div>
            )}
          </div>

          <div className={`lg:col-span-5 rounded-3xl p-6 shadow-xs border ${cardSurface}`}>
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-stone-500 mb-4">
              Disbursement History
            </h4>
            {withdrawals.length === 0 ? (
              <div className="py-10 text-center text-xs text-stone-400">
                No payouts disbursed yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {withdrawals.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between p-3.5 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-800 text-xs"
                  >
                    <div>
                      <p className="font-extrabold">
                        {w.provider_name} • <span className="font-mono">{w.account_number}</span>
                      </p>
                      <p className="text-[11px] text-stone-500 mt-0.5">
                        Ref: {w.reference_number} • {w.account_name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-emerald-900 dark:text-amber-300">
                        ₱{Number(w.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </p>
                      <StatusBadge status={w.status} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
