import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Palette,
  Image as ImageIcon,
  Building2,
  Upload,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  Router,
} from 'lucide-react';
import { api } from '../lib/api';
import { useBranding, BrandingData } from '../lib/branding';
import { useAuth } from '../lib/auth';
import { PageTitle } from '../components/ui';

export default function BrandingSettings() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { branding, updateBrandingState } = useBranding();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [propertyName, setPropertyName] = useState('Oxygen Restaurant and Home');
  const [primaryColor, setPrimaryColor] = useState('#1e3a5f');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [officialEmail, setOfficialEmail] = useState('oxygen@gmail.com');
  const [supportPhone, setSupportPhone] = useState('+9779851129935');
  const [registeredAddress, setRegisteredAddress] = useState('kathmandu Barnani');
  const [panVatNumber, setPanVatNumber] = useState('601234567');
  const [pppoeOnly, setPppoeOnly] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchBrandingSettings();
  }, []);

  const fetchBrandingSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/settings/branding');
      if (res.data) {
        const data: BrandingData = res.data;
        setPropertyName(data.property_name || 'Oxygen Restaurant and Home');
        setPrimaryColor(data.primary_color || '#1e3a5f');
        setLogoUrl(data.logo_url || null);
        setOfficialEmail(data.official_email || '');
        setSupportPhone(data.support_phone || '');
        setRegisteredAddress(data.registered_address || '');
        setPanVatNumber(data.pan_vat_number || '');
        setPppoeOnly(!!data.pppoe_only);

        updateBrandingState(data);
      }
    } catch (err: any) {
      console.error('Failed to load branding settings:', err);
      setError('Failed To Load Branding Settings');
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Logo Image Must Be Less Than 5 MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Logo = reader.result as string;
      setLogoUrl(base64Logo);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload: BrandingData = {
        property_name: propertyName,
        primary_color: primaryColor,
        logo_url: logoUrl,
        official_email: officialEmail,
        support_phone: supportPhone,
        registered_address: registeredAddress,
        pan_vat_number: panVatNumber,
        pppoe_only: pppoeOnly,
      };

      const res = await api.post('/settings/branding', payload);
      
      const updatedData = res.data?.data || payload;
      updateBrandingState(updatedData);

      setSuccess('Branding Settings Saved Successfully!');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      console.error('Failed to save branding settings:', err);
      setError(err.response?.data?.message || 'Failed To Save Branding Settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full space-y-6 pb-12">
      <PageTitle
        title="Branding Settings"
        subtitle="Manage property name, system logo, theme color, and contact details"
        icon={<Palette size={22} className="text-indigo-500" />}
      />

      {/* Notifications / Alerts */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-sm font-semibold"
        >
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl text-sm font-semibold"
        >
          <CheckCircle2 size={18} className="shrink-0" />
          <span>{success}</span>
        </motion.div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-slate-400" size={32} />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          {/* Top Row: Appearance & Global Assets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Card 1: Appearance */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
              <div className="space-y-6">
                <div className="flex items-center gap-2.5 text-slate-800">
                  <Palette className="text-blue-600" size={20} />
                  <h2 className="text-base font-extrabold tracking-tight">Appearance</h2>
                </div>

                <div className="space-y-4">
                  {/* Property Name */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Property Name
                    </label>
                    <input
                      type="text"
                      value={propertyName}
                      onChange={(e) => setPropertyName(e.target.value)}
                      placeholder="Enter Property Name"
                      className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                    />
                  </div>

                  {/* Primary Color */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Primary Color
                    </label>
                    <div className="flex items-center gap-3">
                      {/* Color Swatch Preview Box */}
                      <label
                        htmlFor="primary-color-picker"
                        className="w-10 h-10 rounded-xl border border-slate-300 shadow-xs cursor-pointer shrink-0 transition-transform active:scale-95"
                        style={{ backgroundColor: primaryColor }}
                      >
                        <input
                          id="primary-color-picker"
                          type="color"
                          value={primaryColor}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          className="sr-only"
                        />
                      </label>
                      <input
                        type="text"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        placeholder="#1e3a5f"
                        className="flex-1 px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-mono font-semibold text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Global Assets */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 text-slate-800">
                  <ImageIcon className="text-blue-600" size={20} />
                  <h2 className="text-base font-extrabold tracking-tight">Global Assets</h2>
                </div>

                {/* Upload Box Container */}
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-4 bg-slate-50/30">
                  {/* Logo Preview */}
                  <div className="w-24 h-24 rounded-2xl bg-white border border-slate-200 shadow-xs p-2 flex items-center justify-center overflow-hidden">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Logo Asset" className="max-w-full max-h-full object-contain" />
                    ) : (
                      <div className="text-center p-2">
                        <svg className="w-12 h-12 mx-auto text-rose-500" viewBox="0 0 100 100" fill="none">
                          <circle cx="40" cy="50" r="18" stroke="currentColor" strokeWidth="4" />
                          <path d="M45 25 C60 15, 85 20, 75 45 C65 70, 40 75, 45 25" stroke="currentColor" strokeWidth="3" />
                          <text x="32" y="55" fontSize="14" fontWeight="bold" fill="currentColor">O</text>
                        </svg>
                        <span className="text-[10px] font-bold text-rose-600 block mt-1">Oxygen</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-extrabold text-slate-700 hover:bg-slate-50 shadow-xs flex items-center gap-2 transition-all active:scale-95"
                    >
                      <Upload size={14} />
                      <span>Replace Image</span>
                    </button>
                    {logoUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="p-2.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-all"
                        title="Remove Logo"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleLogoUpload}
                    accept="image/*"
                    className="hidden"
                  />

                  <p className="text-[11px] font-medium text-slate-400">
                    Recommended PNG, 512x512
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Card: Contact Information */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-6">
            <div className="flex items-center gap-2.5 text-slate-800">
              <Building2 className="text-blue-600" size={20} />
              <h2 className="text-base font-extrabold tracking-tight">Contact Information</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Official Email */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Official Email
                </label>
                <input
                  type="email"
                  value={officialEmail}
                  onChange={(e) => setOfficialEmail(e.target.value)}
                  placeholder="oxygen@gmail.com"
                  className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                />
              </div>

              {/* Support Phone */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Support Phone
                </label>
                <input
                  type="text"
                  value={supportPhone}
                  onChange={(e) => setSupportPhone(e.target.value)}
                  placeholder="+9779851129935"
                  className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                />
              </div>

              {/* Registered Address */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Registered Address
                </label>
                <input
                  type="text"
                  value={registeredAddress}
                  onChange={(e) => setRegisteredAddress(e.target.value)}
                  placeholder="kathmandu Barnani"
                  className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                />
              </div>

              {/* PAN/VAT Number */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                  PAN/VAT Number
                </label>
                <input
                  type="text"
                  value={panVatNumber}
                  onChange={(e) => setPanVatNumber(e.target.value)}
                  placeholder="e.g. 601234567"
                  className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                />
              </div>
            </div>
          </div>

          {/* Service mode — admin only; the API ignores this field from other roles. */}
          {isAdmin && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs">
              <div className="flex items-center gap-2.5 text-slate-800 mb-4">
                <Router className="text-blue-600" size={20} />
                <h2 className="text-base font-extrabold tracking-tight">Service Mode</h2>
              </div>
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="text-sm font-extrabold text-slate-800">PPPoE only</p>
                  <p className="text-xs font-medium text-slate-500 mt-1 max-w-xl">
                    Hides everything related to Hotspot (hotspot plans, vouchers, voucher card, hotspot
                    sessions) and blocks the hotspot API. Existing data is kept; turn this off to bring
                    hotspot back.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pppoeOnly}
                  onClick={() => setPppoeOnly((v) => !v)}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                    pppoeOnly ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      pppoeOnly ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Submit Action Bar */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-extrabold text-sm shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 active:scale-95 cursor-pointer"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              <span>Save Branding Settings</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
