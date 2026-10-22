import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  CheckCircle2,
  Lock,
  ArrowRight,
  Ban,
  History,
  ScanLine,
  Webhook,
  Activity,
  Award,
  Fingerprint,
} from 'lucide-react';
import api, {
  extractApiErrorCode,
  extractApiErrorMessage,
  type QrPayload,
  type TransactionRecord,
  type UserProfile,
} from '../lib/api';
import { QrScannerBox } from './QrScannerBox';
import { StatusBadge } from './StatusBadge';

export type FarmerSection = 'scan' | 'review' | 'gateway' | 'history';

interface FarmerCheckoutViewProps {
  farmer: UserProfile;
  activeSection: FarmerSection;
  onNavigateSection: (section: FarmerSection) => void;
  lastGeneratedQrPayload: QrPayload | null;
  onRefreshProfile: () => void;
  darkMode?: boolean;
}

export const FarmerCheckoutView: React.FC<FarmerCheckoutViewProps> = ({
  farmer,
  activeSection,
  onNavigateSection,
  lastGeneratedQrPayload,
  onRefreshProfile,
  darkMode = false,
}) => {
  const [scanning, setScanning] = useState<boolean>(false);
  const [scanAlert, setScanAlert] = useState<{
    type: 'success' | 'error';
    code?: string;
    message: string;
  } | null>(null);

  const [currentTransaction, setCurrentTransaction] = useState<TransactionRecord | null>(null);
  const [checkoutSession, setCheckoutSession] = useState<{
    checkout_session_id: string;
    checkout_url: string;
    provider: string;
  } | null>(null);

  const [processingPayment, setProcessingPayment] = useState<boolean>(false);
  const [settlementNotice, setSettlementNotice] = useState<{
    channel: string;
    idempotent: boolean;
    message: string;
  } | null>(null);

  const [history, setHistory] = useState<TransactionRecord[]>([]);

  const loadFarmerHistory = async () => {
    try {
      const res = await api.get('/farmer/transactions');
      setHistory(res.data.transactions || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadFarmerHistory();
  }, [farmer.id, activeSection]);

  // Background Client-Side Polling Sync while on Review or Gateway screen for a pending transaction
  useEffect(() => {
    const txUuid = currentTransaction?.uuid;
    const txStatus = currentTransaction?.status;
    if (!txUuid || txStatus !== 'pending') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/farmer/transactions/${txUuid}/poll`);
        const updated: TransactionRecord = res.data.transaction;
        setCurrentTransaction(updated);
        if (updated.status === 'paid') {
          onRefreshProfile();
          loadFarmerHistory();
        }
      } catch {
        // silent poll retry
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [currentTransaction?.uuid, currentTransaction?.status, onRefreshProfile]);

  const handleScanPayload = async (payload: QrPayload) => {
    setScanAlert(null);
    setSettlementNotice(null);
    setScanning(true);

    try {
      const res = await api.post('/farmer/qr/scan', {
        qr_payload: payload,
      });

      setCurrentTransaction(res.data.transaction);
      setScanAlert({
        type: 'success',
        code: 'CRYPTOGRAPHIC_QR_VERIFIED',
        message: res.data.message,
      });
      onNavigateSection('review');
    } catch (err: unknown) {
      setScanAlert({
        type: 'error',
        code: extractApiErrorCode(err, 'QR_VERIFICATION_REJECTED'),
        message: extractApiErrorMessage(
          err,
          'QR payload failed cryptographic signature or beneficiary ownership verification.'
        ),
      });
    } finally {
      setScanning(false);
    }
  };

  const handleProceedToGateway = async () => {
    if (!currentTransaction) return;
    setProcessingPayment(true);
    setScanAlert(null);

    try {
      const res = await api.post(`/farmer/transactions/${currentTransaction.uuid}/checkout`);
      setCheckoutSession(res.data.checkout_session);
      setCurrentTransaction(res.data.transaction);
      onNavigateSection('gateway');
    } catch (err: unknown) {
      setScanAlert({
        type: 'error',
        code: extractApiErrorCode(err, 'CHECKOUT_ERROR'),
        message: extractApiErrorMessage(err, 'Unable to initialize payment gateway session.'),
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  /**
   * Dual-Path Settlement Path A: Trigger Asynchronous Webhook Settlement
   */
  const handleSettleViaWebhook = async (customEventId?: string) => {
    if (!currentTransaction) return;
    setProcessingPayment(true);

    const eventId = customEventId || `evt_wh_${currentTransaction.uuid}`;

    try {
      const res = await api.post('/webhooks/payment', {
        event_id: eventId,
        event_type: 'payment.settlement.succeeded',
        transaction_uuid: currentTransaction.uuid,
        status: 'succeeded',
      });

      setCurrentTransaction(res.data.transaction);
      setSettlementNotice({
        channel: 'Asynchronous Webhook (Path A)',
        idempotent: Boolean(res.data.idempotent_replay),
        message: res.data.message,
      });
      onRefreshProfile();
      await loadFarmerHistory();
    } catch (err: unknown) {
      setScanAlert({
        type: 'error',
        code: extractApiErrorCode(err, 'WEBHOOK_SETTLEMENT_ERROR'),
        message: extractApiErrorMessage(err, 'Webhook settlement rejected.'),
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  /**
   * Dual-Path Settlement Path B: Trigger Client-Side Polling Sync Reconciliation
   */
  const handleSettleViaPollingSync = async () => {
    if (!currentTransaction) return;
    setProcessingPayment(true);

    try {
      const res = await api.get(`/farmer/transactions/${currentTransaction.uuid}/poll`, {
        params: {
          reconcile_gateway: true,
          event_id: `evt_poll_sync_${currentTransaction.uuid}`,
        },
      });

      setCurrentTransaction(res.data.transaction);
      setSettlementNotice({
        channel: 'Client-Side Polling Sync (Path B)',
        idempotent: Boolean(res.data.idempotent_replay),
        message: res.data.message,
      });
      onRefreshProfile();
      await loadFarmerHistory();
    } catch (err: unknown) {
      setScanAlert({
        type: 'error',
        code: extractApiErrorCode(err, 'POLLING_SYNC_ERROR'),
        message: extractApiErrorMessage(err, 'Polling sync reconciliation rejected.'),
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!currentTransaction) return;
    setProcessingPayment(true);
    try {
      const res = await api.post(`/farmer/transactions/${currentTransaction.uuid}/cancel`);
      setCurrentTransaction(res.data.transaction);
      await loadFarmerHistory();
    } catch {
      // ignore
    } finally {
      setProcessingPayment(false);
    }
  };

  const cardSurface = darkMode
    ? 'bg-stone-900/90 border-stone-800 text-stone-100'
    : 'bg-white border-stone-200/80 text-stone-900';

  return (
    <div className="space-y-6">
      {/* Digital RSBSA Beneficiary Smart Pass & Quota Telemetry Header */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="md:col-span-7 rounded-3xl bg-gradient-to-br from-[#0c2618] via-[#133b26] to-[#0a2115] text-white p-5 sm:p-6 shadow-lg border border-emerald-700/40 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/30 text-amber-300 text-[10px] font-bold uppercase tracking-widest">
              <Fingerprint className="w-3.5 h-3.5" />
              National Farmer Registry Smart Card
            </span>
            <span className="font-mono text-xs text-emerald-300 font-bold">{farmer.beneficiary_id}</span>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">{farmer.name}</h2>
              <p className="text-xs text-emerald-200/80 mt-0.5">{farmer.region}</p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[10px] uppercase tracking-wider text-emerald-300/80 font-semibold">
                Allocated Subsidy Balance
              </p>
              <p className="text-2xl sm:text-3xl font-black text-amber-300">
                ₱{Number(farmer.subsidy_balance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>

        {/* High-Nitrogen Seasonal Quota Card (5 cols) */}
        <div className={`md:col-span-5 rounded-3xl p-5 sm:p-6 border shadow-xs flex flex-col justify-between ${cardSurface}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">
                High-Nitrogen Quota (Option A)
              </p>
              <h3 className="text-lg font-black mt-0.5">
                {farmer.high_nitrogen_quota?.remaining_bags ?? 5} of {farmer.high_nitrogen_quota?.max_bags ?? 5} Bags Available
              </h3>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
          </div>

          <div className="mt-3">
            <div className="grid grid-cols-5 gap-1.5">
              {[1, 2, 3, 4, 5].map((slot) => {
                const used = farmer.high_nitrogen_quota?.used_bags ?? 0;
                const isUsed = slot <= used;
                return (
                  <div
                    key={slot}
                    className={`h-2.5 rounded-full transition ${
                      isUsed ? 'bg-stone-300 dark:bg-stone-700' : 'bg-emerald-600'
                    }`}
                  />
                );
              })}
            </div>
            <p className="text-[11px] text-stone-500 mt-2">
              Cropping Season: <strong>{farmer.high_nitrogen_quota?.cropping_season || '2026-WET'}</strong> • Used: {farmer.high_nitrogen_quota?.used_bags ?? 0} bag(s)
            </p>
          </div>
        </div>
      </div>

      {/* Security Verification / Error Banner */}
      {scanAlert && (
        <div
          data-testid="qr-scan-alert"
          className={`p-4 rounded-2xl border flex items-start gap-3 shadow-xs ${
            scanAlert.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : 'bg-red-50 border-red-300 text-red-950'
          }`}
        >
          {scanAlert.type === 'success' ? (
            <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
          )}
          <div className="text-xs">
            <p className="font-mono font-bold uppercase tracking-wider">
              [{scanAlert.code}]
            </p>
            <p className="font-medium mt-0.5">{scanAlert.message}</p>
          </div>
        </div>
      )}

      {/* SECTION 1: QR SCANNER UI (Module 2) */}
      {activeSection === 'scan' && (
        <div className="max-w-2xl mx-auto">
          <div className={`rounded-3xl p-5 sm:p-6 shadow-xs border ${cardSurface}`}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                  Step 1 • Optical & Cryptographic Verification
                </p>
                <h3 className="text-lg font-extrabold">
                  Scan Merchant POS Dynamic QR Code
                </h3>
              </div>
              <ScanLine className="w-6 h-6 text-emerald-700" />
            </div>

            <QrScannerBox
              onScanPayload={handleScanPayload}
              lastGeneratedQrPayload={lastGeneratedQrPayload}
              loading={scanning}
            />
          </div>
        </div>
      )}

      {/* SECTION 2: FARMER'S ORDER REVIEW & CHECKOUT SUMMARY SCREEN (Module 2 & Module 3) */}
      {activeSection === 'review' && (
        <div className="max-w-2xl mx-auto">
          <div className={`rounded-3xl p-6 shadow-xs border space-y-5 ${cardSurface}`}>
            {!currentTransaction ? (
              <div className="py-10 text-center space-y-3">
                <ScanLine className="w-8 h-8 text-stone-400 mx-auto" />
                <p className="text-xs text-stone-500 font-semibold">No active scanned order selected yet.</p>
                <button
                  type="button"
                  onClick={() => onNavigateSection('scan')}
                  className="px-4 py-2.5 rounded-xl bg-[#0f2e1d] text-white text-xs font-bold cursor-pointer"
                >
                  Open QR Scanner →
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-stone-200 dark:border-stone-800">
                  <div>
                    <span className="text-[11px] font-mono uppercase text-emerald-800 dark:text-emerald-300 font-bold">
                      Step 2 • Verified Subsidy Invoice
                    </span>
                    <h3 className="text-lg font-black">
                      {currentTransaction.merchant?.store_name || currentTransaction.merchant?.name}
                    </h3>
                  </div>
                  <StatusBadge status={currentTransaction.status} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-stone-50 dark:bg-stone-800/50 p-4 rounded-2xl border border-stone-200 dark:border-stone-800">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-stone-500 font-bold">
                      Composite Security Reference
                    </p>
                    <p className="font-mono font-bold break-all mt-0.5">
                      {currentTransaction.reference_string}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-stone-500 font-bold">
                      Beneficiary Ownership & TTL
                    </p>
                    <p className="font-mono font-bold text-emerald-800 dark:text-emerald-300 mt-0.5">
                      {currentTransaction.beneficiary_id} • Expires {new Date(currentTransaction.expires_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-stone-200 dark:divide-stone-800 border border-stone-200 dark:border-stone-800 rounded-2xl overflow-hidden">
                  {currentTransaction.items?.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm">{item.product_name}</span>
                          {item.is_high_nitrogen && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                              High-Nitrogen
                            </span>
                          )}
                        </div>
                        <p className="text-stone-500 font-mono mt-0.5">
                          {item.quantity} bag(s) × ₱{Number(item.unit_price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <p className="font-mono font-black text-sm">
                        ₱{Number(item.subtotal).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  ))}

                  <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/40 flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-950 dark:text-emerald-200">
                      Total Subsidy Deduction
                    </span>
                    <span className="text-xl font-black text-emerald-950 dark:text-amber-300">
                      ₱{Number(currentTransaction.total_amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {currentTransaction.status === 'pending' ? (
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      type="button"
                      disabled={processingPayment}
                      onClick={handleCancelOrder}
                      className="px-4 py-3 rounded-2xl border border-stone-300 text-stone-700 dark:text-stone-200 font-bold text-xs hover:bg-stone-100 transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Ban className="w-4 h-4" />
                      <span>Decline Order</span>
                    </button>

                    <button
                      type="button"
                      disabled={processingPayment}
                      onClick={handleProceedToGateway}
                      className="flex-1 px-5 py-3.5 rounded-2xl bg-[#0f2e1d] hover:bg-emerald-900 text-white font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-md cursor-pointer"
                    >
                      <span>Authorize & Proceed to Payment Gateway</span>
                      <ArrowRight className="w-4 h-4 text-amber-300" />
                    </button>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-between text-xs">
                    <span>
                      Order Status: <strong>{currentTransaction.status.toUpperCase()}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => onNavigateSection('gateway')}
                      className="text-emerald-800 dark:text-amber-300 font-extrabold hover:underline cursor-pointer"
                    >
                      Open Settlement Telemetry →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* SECTION 3: HOSTED PAYMENT GATEWAY & DUAL-PATH SETTLEMENT SIMULATOR */}
      {activeSection === 'gateway' && currentTransaction && (
        <div className="max-w-2xl mx-auto space-y-4">
          <div className={`rounded-3xl p-6 shadow-md border-2 border-emerald-700/30 space-y-5 ${cardSurface}`}>
            <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold">
                    {checkoutSession?.provider || 'AgriPay National Subsidy Hosted Checkout'}
                  </h3>
                  <p className="text-[11px] font-mono text-stone-500">
                    Session ID: {currentTransaction.checkout_session_id || checkoutSession?.checkout_session_id || 'Active'}
                  </p>
                </div>
              </div>
              <StatusBadge status={currentTransaction.status} />
            </div>

            <div className="p-4 rounded-2xl bg-[#0f2e1d] text-white flex items-center justify-between">
              <div>
                <p className="text-[10px] text-emerald-300 uppercase tracking-widest font-bold">
                  Authorized Settlement Reference
                </p>
                <p className="text-xs font-mono mt-0.5">{currentTransaction.reference_string}</p>
              </div>
              <p className="text-2xl font-black text-amber-300">
                ₱{Number(currentTransaction.total_amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-extrabold uppercase tracking-wider text-stone-500">
                Dual-Path Settlement & Idempotency Telemetry Controls
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={processingPayment}
                  onClick={() => handleSettleViaWebhook()}
                  className="p-4 rounded-2xl bg-[#0f2e1d] hover:bg-emerald-900 text-white text-left transition shadow-sm cursor-pointer"
                >
                  <div className="flex items-center gap-2 font-extrabold text-xs">
                    <Webhook className="w-4 h-4 text-amber-300" />
                    <span>1. Complete Payment (Async Webhook)</span>
                  </div>
                  <p className="text-[11px] text-emerald-200/90 mt-1">
                    Dispatches signed gateway webhook event with pessimistic DB locking (`SELECT ... FOR UPDATE`).
                  </p>
                </button>

                <button
                  type="button"
                  disabled={processingPayment}
                  onClick={handleSettleViaPollingSync}
                  className="p-4 rounded-2xl bg-teal-900 hover:bg-teal-950 text-white text-left transition shadow-sm cursor-pointer"
                >
                  <div className="flex items-center gap-2 font-extrabold text-xs">
                    <Activity className="w-4 h-4 text-emerald-300" />
                    <span>2. Client-Side Polling Sync Fallback</span>
                  </div>
                  <p className="text-[11px] text-teal-200/90 mt-1">
                    Simulates connectivity recovery if redirect drops; reconciles state idempotently.
                  </p>
                </button>
              </div>

              {currentTransaction.status === 'paid' && (
                <button
                  type="button"
                  disabled={processingPayment}
                  onClick={() => handleSettleViaWebhook(`evt_wh_${currentTransaction.uuid}`)}
                  className="w-full py-3 px-4 rounded-2xl bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 text-xs font-extrabold flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Test Idempotency: Replay Exact Same Webhook Event ID (Verify Zero Duplicate Deduction)</span>
                </button>
              )}
            </div>

            {settlementNotice && (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs space-y-1">
                <div className="flex items-center justify-between font-bold">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    <span>{settlementNotice.channel}</span>
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-200 text-emerald-950 text-[10px] uppercase font-extrabold">
                    {settlementNotice.idempotent ? 'Idempotent Replay (No-Op)' : 'Primary Atomic Settlement'}
                  </span>
                </div>
                <p className="text-emerald-900">{settlementNotice.message}</p>
              </div>
            )}

            <div className="pt-4 border-t border-stone-200 dark:border-stone-800">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-stone-500 mb-2.5">
                Immutable Payment Audit Trail (`payment_logs`)
              </h4>
              {!currentTransaction.payment_logs || currentTransaction.payment_logs.length === 0 ? (
                <p className="text-xs text-stone-500">No settlement events recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {currentTransaction.payment_logs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-800 text-[11px] flex items-center justify-between"
                    >
                      <div>
                        <p className="font-mono font-bold">Event ID: {log.event_id}</p>
                        <p className="text-stone-500">
                          Channel: <strong>{log.settlement_channel}</strong> • Type: {log.event_type}
                        </p>
                      </div>
                      <StatusBadge status={log.status} size="sm" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: FARMER SUBSIDY ORDER HISTORY */}
      {activeSection === 'history' && (
        <div className="max-w-2xl mx-auto">
          <div className={`rounded-3xl p-6 shadow-xs border ${cardSurface}`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                  Beneficiary Passbook
                </p>
                <h3 className="text-lg font-extrabold">
                  My Subsidized Fertilizer Orders
                </h3>
              </div>
              <History className="w-5 h-5 text-stone-400" />
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-stone-500 py-8 text-center">No subsidy transactions found.</p>
            ) : (
              <div className="space-y-2.5">
                {history.map((tx) => (
                  <div
                    key={tx.id}
                    onClick={() => {
                      setCurrentTransaction(tx);
                      onNavigateSection('review');
                    }}
                    className="p-4 rounded-2xl bg-stone-50 dark:bg-stone-800/50 hover:bg-emerald-50/50 border border-stone-200 dark:border-stone-800 flex items-center justify-between cursor-pointer transition"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-extrabold">
                          {tx.merchant?.store_name || 'Accredited Merchant'}
                        </span>
                        <StatusBadge status={tx.status} size="sm" />
                      </div>
                      <p className="text-[11px] font-mono text-stone-500 mt-1">
                        {tx.reference_string}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-black text-emerald-950 dark:text-amber-300">
                        ₱{Number(tx.total_amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-[10px] text-emerald-800 dark:text-emerald-400 font-bold">
                        Inspect Invoice →
                      </p>
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
