import axios from 'axios';

export interface HighNitrogenQuota {
  cropping_season: string;
  used_bags: number;
  max_bags: number;
  remaining_bags: number;
}

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: 'farmer' | 'merchant';
  beneficiary_id: string | null;
  store_name: string | null;
  region: string | null;
  subsidy_balance: string;
  wallet_balance: string;
  high_nitrogen_quota?: HighNitrogenQuota;
}

export interface ProductItem {
  id: number;
  merchant_id: number;
  sku: string;
  name: string;
  description: string;
  category: 'high_nitrogen' | 'balanced_npk' | 'organic' | 'potash_phosphate';
  npk_ratio: string;
  is_high_nitrogen: boolean;
  unit: string;
  unit_price: string;
  stock_quantity: number;
  is_active: boolean;
}

export interface QrPayload {
  protocol: string;
  transaction_uuid: string;
  beneficiary_id: string;
  merchant_id: number;
  total_amount: string;
  timestamp: number;
  expires_at: string;
  reference_string: string;
  signature: string;
}

export interface TransactionItemRecord {
  id: number;
  transaction_id: number;
  product_id: number;
  product_name: string;
  category: string;
  is_high_nitrogen: boolean;
  quantity: number;
  unit_price: string;
  subtotal: string;
}

export interface PaymentLogRecord {
  id: number;
  event_id: string;
  transaction_id: number;
  event_type: string;
  settlement_channel: 'webhook' | 'polling_sync' | 'gateway_direct';
  amount: string;
  status: string;
  processed_at: string;
}

export interface TransactionRecord {
  id: number;
  uuid: string;
  reference_string: string;
  merchant_id: number;
  farmer_id: number;
  beneficiary_id: string;
  total_amount: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  qr_signature: string;
  qr_timestamp: number;
  expires_at: string;
  checkout_session_id: string | null;
  cropping_season: string;
  paid_at: string | null;
  created_at: string;
  items?: TransactionItemRecord[];
  merchant?: UserProfile;
  farmer?: UserProfile;
  payment_logs?: PaymentLogRecord[];
}

export interface WithdrawalRecord {
  id: number;
  uuid: string;
  merchant_id: number;
  amount: string;
  payout_method: 'bank_transfer' | 'gcash' | 'maya';
  provider_name: string;
  account_name: string;
  account_number: string;
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  reference_number: string;
  created_at: string;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fds_auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function extractApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    if (data?.message) {
      return data.message;
    }
  }
  return fallback;
}

export function extractApiErrorCode(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error_code?: string } | undefined;
    if (data?.error_code) {
      return data.error_code;
    }
  }
  return fallback;
}

export function isRequestCanceled(err: unknown): boolean {
  return axios.isCancel(err);
}

export default api;
