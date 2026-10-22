import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import jsQR from 'jsqr';
import { Camera, Upload, ShieldAlert, Sparkles, FileCode, Eye, Video, VideoOff } from 'lucide-react';
import { type QrPayload } from '../lib/api';

interface QrScannerBoxProps {
  onScanPayload: (payload: QrPayload) => void;
  lastGeneratedQrPayload: QrPayload | null;
  loading?: boolean;
}

export const QrScannerBox: React.FC<QrScannerBoxProps> = ({
  onScanPayload,
  lastGeneratedQrPayload,
  loading = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [rawJsonInput, setRawJsonInput] = useState<string>('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [showTamperLab, setShowTamperLab] = useState<boolean>(false);

  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        html5QrCodeRef.current.stop().catch(() => undefined);
      }
    };
  }, []);

  const toggleLiveCamera = async () => {
    setScanError(null);
    if (cameraActive && html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
      } catch {
        // ignore
      }
      setCameraActive(false);
      return;
    }

    try {
      const scanner = new Html5Qrcode('fds-live-qr-reader');
      html5QrCodeRef.current = scanner;
      setCameraActive(true);
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 200, height: 200 } },
        (decodedText) => {
          try {
            const parsed = JSON.parse(decodedText) as QrPayload;
            setRawJsonInput(JSON.stringify(parsed, null, 2));
            scanner.stop().catch(() => undefined);
            setCameraActive(false);
            onScanPayload(parsed);
          } catch {
            setScanError('Scanned optical QR code is not a valid FDS JSON payload.');
          }
        },
        () => {
          // frame scan in progress
        }
      );
    } catch {
      setCameraActive(false);
      setScanError(
        'Camera permission unavailable or no webcam detected. Use the QR Photo Upload fallback or 1-Click POS Scan below.'
      );
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setScanError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setScanError('Unable to initialize canvas context for QR image decoding.');
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code && code.data) {
          try {
            const parsed = JSON.parse(code.data) as QrPayload;
            setRawJsonInput(JSON.stringify(parsed, null, 2));
            onScanPayload(parsed);
          } catch {
            setScanError('QR image decoded, but payload is not valid FDS JSON protocol.');
          }
        } else {
          setScanError('No valid QR code found in the uploaded image. Try using the clear PNG download from Merchant POS.');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleLoadLatestPosQr = () => {
    setScanError(null);
    if (!lastGeneratedQrPayload) {
      setScanError('No recent Merchant POS QR found in browser session. Create one in Merchant POS first or upload QR photo.');
      return;
    }
    setRawJsonInput(JSON.stringify(lastGeneratedQrPayload, null, 2));
    onScanPayload(lastGeneratedQrPayload);
  };

  const handleTamperAmountAndScan = () => {
    setScanError(null);
    const basePayload = rawJsonInput
      ? (JSON.parse(rawJsonInput) as QrPayload)
      : lastGeneratedQrPayload;

    if (!basePayload) {
      setScanError('Generate or load a valid QR payload first before testing tamper resistance.');
      return;
    }

    const tampered: QrPayload = {
      ...basePayload,
      total_amount: '50.00',
    };
    setRawJsonInput(JSON.stringify(tampered, null, 2));
    onScanPayload(tampered);
  };

  const handleTamperBeneficiaryAndScan = () => {
    setScanError(null);
    const basePayload = rawJsonInput
      ? (JSON.parse(rawJsonInput) as QrPayload)
      : lastGeneratedQrPayload;

    if (!basePayload) {
      setScanError('Generate or load a valid QR payload first before testing tamper resistance.');
      return;
    }

    const tampered: QrPayload = {
      ...basePayload,
      beneficiary_id: 'RSBSA-99-HACKED-0000',
    };
    setRawJsonInput(JSON.stringify(tampered, null, 2));
    onScanPayload(tampered);
  };

  const handleManualJsonSubmit = () => {
    setScanError(null);
    try {
      const parsed = JSON.parse(rawJsonInput) as QrPayload;
      onScanPayload(parsed);
    } catch {
      setScanError('Invalid JSON format in payload inspector.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Camera Viewport with Dimmed Overlay & Centered Targeting Box (Module 2 Requirement) */}
      <div className="relative overflow-hidden rounded-2xl bg-stone-950 text-white shadow-xl border border-emerald-900/40 aspect-4/3 max-h-80 flex flex-col items-center justify-center">
        {/* Live Camera Mount Container */}
        <div
          id="fds-live-qr-reader"
          className={`absolute inset-0 z-0 ${cameraActive ? 'block' : 'hidden'}`}
        />

        {/* Simulated Optical Feed Background Grid */}
        {!cameraActive && (
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                'radial-gradient(circle at center, rgba(16, 185, 129, 0.35) 0%, transparent 70%), linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
              backgroundSize: '100% 100%, 24px 24px, 24px 24px',
            }}
          />
        )}

        {/* Dimmed Outer Mask Overlay */}
        <div className="absolute inset-0 bg-black/55 pointer-events-none" />

        {/* Top Instructional Pill */}
        <div className="relative z-10 mb-3 px-3.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center gap-1.5 shadow-md">
          <Camera className="w-3.5 h-3.5 text-emerald-400" />
          <span>Align Merchant POS Dynamic QR Inside Target Frame</span>
        </div>

        {/* Centered Targeting Box */}
        <div className="relative z-10 w-48 h-48 rounded-2xl border border-emerald-400/30 bg-emerald-950/10 backdrop-blur-[1px] flex flex-col items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-none">
          {/* Corner Brackets */}
          <div className="absolute -top-0.5 -left-0.5 w-7 h-7 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
          <div className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
          <div className="absolute -bottom-0.5 -left-0.5 w-7 h-7 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
          <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />

          {/* Animated Laser Scanline */}
          <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399] animate-scanline" />

          <div className="text-center px-4">
            <p className="text-[11px] uppercase tracking-widest text-emerald-300/90 font-semibold">
              FDS-QR-V1 Optical
            </p>
            <p className="text-[11px] text-stone-300 mt-1">
              HMAC-SHA256 + 15m TTL
            </p>
          </div>
        </div>

        {/* Bottom Instructional Label */}
        <p className="relative z-10 mt-3 text-xs text-stone-300 text-center px-6">
          Supports live camera optical scan, QR image upload, or instant POS terminal handoff
        </p>
      </div>

      {/* Interactive Fallbacks (Live Camera + Photo Upload + 1-Click Live POS Handoff) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileUpload}
          className="hidden"
        />

        <button
          type="button"
          disabled={loading}
          onClick={toggleLiveCamera}
          className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-900 border border-stone-300 font-semibold text-xs transition cursor-pointer"
        >
          {cameraActive ? (
            <>
              <VideoOff className="w-4 h-4 text-red-600" />
              <span>Stop Camera</span>
            </>
          ) : (
            <>
              <Video className="w-4 h-4 text-emerald-700" />
              <span>Live Camera</span>
            </>
          )}
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-white border border-emerald-800/20 text-emerald-950 font-semibold text-xs hover:bg-emerald-50 transition shadow-2xs cursor-pointer"
        >
          <Upload className="w-4 h-4 text-emerald-700" />
          <span>Upload QR Photo</span>
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={handleLoadLatestPosQr}
          className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#0f2e1d] text-white font-semibold text-xs hover:bg-emerald-900 transition shadow-sm cursor-pointer"
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span>Scan Active POS QR</span>
        </button>
      </div>

      {/* Cryptographic Tamper & Inspector Drawer (Module 4 Audit Demonstration) */}
      <div className="rounded-xl border border-stone-200 bg-stone-50/90 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-stone-800">
            <FileCode className="w-4 h-4 text-emerald-800" />
            <span>Cryptographic Payload Inspector & Tamper Simulator</span>
          </div>
          <button
            type="button"
            onClick={() => setShowTamperLab(!showTamperLab)}
            className="text-xs font-medium text-emerald-800 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{showTamperLab ? 'Hide Lab' : 'Open Lab'}</span>
          </button>
        </div>

        {showTamperLab && (
          <div className="mt-3 space-y-2.5">
            <p className="text-xs text-stone-600">
              Use the buttons below during your walkthrough video to demonstrate how the backend rejects altered{' '}
              <code className="bg-stone-200 px-1 rounded">total_amount</code> or{' '}
              <code className="bg-stone-200 px-1 rounded">beneficiary_id</code> payloads:
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleTamperAmountAndScan}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-100 text-red-900 border border-red-300 text-xs font-semibold hover:bg-red-200 transition cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-red-700" />
                <span>Simulate Tampered Amount (₱50.00)</span>
              </button>

              <button
                type="button"
                onClick={handleTamperBeneficiaryAndScan}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold hover:bg-amber-200 transition cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                <span>Simulate Tampered Beneficiary ID</span>
              </button>
            </div>

            <textarea
              rows={5}
              value={rawJsonInput}
              onChange={(e) => setRawJsonInput(e.target.value)}
              placeholder='Paste or inspect signed QR JSON payload here (e.g. {"protocol":"FDS-QR-V1", ...})'
              className="w-full rounded-lg border border-stone-300 bg-white p-2.5 font-mono text-[11px] text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />

            <button
              type="button"
              onClick={handleManualJsonSubmit}
              className="w-full py-2 rounded-lg bg-stone-800 text-white text-xs font-semibold hover:bg-stone-900 transition cursor-pointer"
            >
              Submit Inspected JSON Payload to Scanner Endpoint
            </button>
          </div>
        )}
      </div>

      {scanError && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
          {scanError}
        </div>
      )}
    </div>
  );
};
