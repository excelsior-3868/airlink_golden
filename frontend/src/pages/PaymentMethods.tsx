import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, Plus, Edit3, Trash2, CheckCircle, AlertCircle, Upload, Image } from 'lucide-react';
import { api } from '../lib/api';
import { PageTitle, GlassCard, CustomSelect, Pill, Spinner } from '../components/ui';

interface PaymentMethodItem {
  id: number;
  icon: string | null;
  label: string;
  code: string;
  status: 'active' | 'disabled';
  sort_order: number;
}

export default function PaymentMethods() {
  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PaymentMethodItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form inputs
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [icon, setIcon] = useState('💵');
  const [status, setStatus] = useState<'active' | 'disabled'>('active');
  const [sortOrder, setSortOrder] = useState('0');

  const fetchMethods = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/payment-methods');
      if (res.data?.success) {
        setMethods(res.data.data || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load payment methods.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMethods();
  }, []);

  const openAddModal = () => {
    setEditingItem(null);
    setLabel('');
    setCode('');
    setIcon('💵');
    setStatus('active');
    setSortOrder(String(methods.length * 10));
    setError('');
    setModalOpen(true);
  };

  const openEditModal = (pm: PaymentMethodItem) => {
    setEditingItem(pm);
    setLabel(pm.label);
    setCode(pm.code);
    setIcon(pm.icon || '💵');
    setStatus(pm.status);
    setSortOrder(String(pm.sort_order));
    setError('');
    setModalOpen(true);
  };

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setError('Image file size must be less than 2MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setIcon(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !code.trim()) {
      setError('Label and Code are required.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const payload = {
        label: label.trim(),
        code: code.trim().toUpperCase().replace(/\s+/g, '_'),
        icon: icon.trim() || null,
        status,
        sort_order: parseInt(sortOrder, 10) || 0,
      };

      if (editingItem) {
        await api.put(`/admin/payment-methods/${editingItem.id}`, payload);
        setSuccess('Payment method updated successfully.');
      } else {
        await api.post('/admin/payment-methods', payload);
        setSuccess('Payment method created successfully.');
      }

      setModalOpen(false);
      fetchMethods();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save payment method.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (pm: PaymentMethodItem) => {
    if (!window.confirm(`Are you sure you want to delete payment method "${pm.label}"?`)) {
      return;
    }

    try {
      await api.delete(`/admin/payment-methods/${pm.id}`);
      setSuccess('Payment method deleted successfully.');
      fetchMethods();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete payment method.');
    }
  };

  const renderIconBadge = (iconVal: string | null, codeVal: string) => {
    if (iconVal && (iconVal.startsWith('data:image') || iconVal.startsWith('http') || iconVal.startsWith('/') || iconVal.endsWith('.png'))) {
      return <img src={iconVal} alt={codeVal} className="w-6 h-6 object-contain rounded" />;
    }
    if (codeVal === 'CASH' || iconVal === '💵') {
      return <span className="text-xl">💵</span>;
    }
    if (codeVal === 'QR_ESEWA' || iconVal === '🟢') {
      return <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-xs">e</span>;
    }
    if (codeVal === 'QR_KHALTI' || iconVal === '🚀') {
      return <span className="text-xl">🚀</span>;
    }
    if (codeVal === 'CARD' || iconVal === '💳') {
      return <span className="text-xl">💳</span>;
    }
    if (codeVal === 'FONEPAY_QR' || iconVal === '📲') {
      return <span className="text-xs bg-rose-600 text-white font-extrabold px-1.5 py-0.5 rounded tracking-tighter">fonepay</span>;
    }
    return <span className="text-xl">{iconVal || '💳'}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <PageTitle
          title="Payment Methods"
          subtitle="Manage payment methods available for payments, settlements, and accounting"
          icon={<CreditCard className="text-sky-500" size={24} />}
        />
        <button
          onClick={openAddModal}
          className="btn-primary flex items-center gap-2 text-xs font-bold px-4 py-2.5 shadow-lg shadow-sky-600/20"
        >
          <Plus size={16} />
          Add Payment Method
        </button>
      </div>

      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle size={16} />
          {success}
        </div>
      )}

      {error && !modalOpen && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <GlassCard className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Icon</th>
                  <th>Label</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Sort Order</th>
                  <th className="text-right pr-6">Actions</th>
                </tr>
              </thead>
              <tbody>
                {methods.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-400 text-xs">
                      No payment methods found. Click "Add Payment Method" to create one.
                    </td>
                  </tr>
                ) : (
                  methods.map((pm, idx) => (
                    <motion.tr
                      key={pm.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04 }}
                      className="hover:bg-slate-50/50 transition-all"
                    >
                      <td className="w-16">
                        <div className="w-9 h-9 rounded-xl bg-slate-100/80 flex items-center justify-center">
                          {renderIconBadge(pm.icon, pm.code)}
                        </div>
                      </td>
                      <td className="font-semibold text-slate-800">{pm.label}</td>
                      <td>
                        <span className="font-mono text-xs text-slate-600 font-semibold bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
                          {pm.code}
                        </span>
                      </td>
                      <td>
                        <Pill tone={pm.status === 'active' ? 'success' : 'danger'}>
                          {pm.status === 'active' ? 'Active' : 'Disabled'}
                        </Pill>
                      </td>
                      <td className="font-semibold text-slate-700">{pm.sort_order}</td>
                      <td className="text-right pr-6 whitespace-nowrap">
                        <button
                          onClick={() => openEditModal(pm)}
                          className="p-1.5 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-all mr-1"
                          title="Edit Payment Method"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(pm)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                          title="Delete Payment Method"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-5"
          >
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-slate-100/90 flex items-center justify-center border border-slate-200/80">
                  {renderIconBadge(icon, code)}
                </div>
                <h3 className="text-base font-bold text-slate-800">
                  {editingItem ? 'Edit Payment Method' : 'Add Payment Method'}
                </h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle size={15} />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  Label
                </label>
                <input
                  className="input py-2 text-xs"
                  placeholder="e.g. Fonepay QR"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  Code
                </label>
                <input
                  className="input py-2 text-xs font-mono uppercase"
                  placeholder="e.g. FONEPAY_QR"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                  required
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  Icon / PNG Image
                </label>
                
                {/* PNG Upload Placeholder & Drop Area */}
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex-1 cursor-pointer border border-dashed border-slate-300 hover:border-sky-500 bg-slate-50/50 hover:bg-sky-50/30 p-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs text-slate-600 font-semibold">
                    <Upload size={14} className="text-sky-500" />
                    <span>Upload PNG Icon (max 2MB)</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml"
                      className="hidden"
                      onChange={handleIconUpload}
                    />
                  </label>
                  {icon && (
                    <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                      {renderIconBadge(icon, code)}
                    </div>
                  )}
                </div>

                <input
                  className="input py-2 text-xs"
                  placeholder="Or paste Image URL / Emoji (e.g. https://... or 💵)"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Sort Order
                  </label>
                  <input
                    type="number"
                    className="input py-2 text-xs"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Status
                  </label>
                  <CustomSelect
                    value={status}
                    onChange={(val) => setStatus(val as 'active' | 'disabled')}
                    options={[
                      { value: 'active', label: 'Active' },
                      { value: 'disabled', label: 'Disabled' },
                    ]}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn-ghost py-2 text-xs"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary py-2 text-xs px-5 flex items-center gap-2"
                >
                  {submitting ? <Spinner className="w-3.5 h-3.5" /> : null}
                  {editingItem ? 'Update Payment Method' : 'Save Payment Method'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
