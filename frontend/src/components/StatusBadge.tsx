import React from 'react';
import { CheckCircle2, Clock, XCircle, Ban } from 'lucide-react';

interface StatusBadgeProps {
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const normalized = status.toLowerCase();

  const sizeClasses =
    size === 'sm'
      ? 'px-2.5 py-0.5 text-xs gap-1'
      : 'px-3 py-1 text-xs font-semibold gap-1.5';

  switch (normalized) {
    case 'paid':
    case 'completed':
    case 'settled':
      return (
        <span
          className={`inline-flex items-center rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-2xs ${sizeClasses}`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
          <span className="uppercase tracking-wider">paid</span>
        </span>
      );
    case 'pending':
      return (
        <span
          className={`inline-flex items-center rounded-full bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs ${sizeClasses}`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-700 animate-pulse shrink-0" />
          <span className="uppercase tracking-wider">pending</span>
        </span>
      );
    case 'failed':
    case 'rejected':
      return (
        <span
          className={`inline-flex items-center rounded-full bg-red-100 text-red-900 border border-red-300 shadow-2xs ${sizeClasses}`}
        >
          <XCircle className="w-3.5 h-3.5 text-red-700 shrink-0" />
          <span className="uppercase tracking-wider">failed</span>
        </span>
      );
    case 'cancelled':
      return (
        <span
          className={`inline-flex items-center rounded-full bg-stone-200 text-stone-800 border border-stone-300 shadow-2xs ${sizeClasses}`}
        >
          <Ban className="w-3.5 h-3.5 text-stone-600 shrink-0" />
          <span className="uppercase tracking-wider">cancelled</span>
        </span>
      );
    default:
      return (
        <span
          className={`inline-flex items-center rounded-full bg-stone-100 text-stone-700 border border-stone-300 ${sizeClasses}`}
        >
          <span className="uppercase tracking-wider">{status}</span>
        </span>
      );
  }
};
