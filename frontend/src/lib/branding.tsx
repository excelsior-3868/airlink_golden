import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from './api';

export interface BrandingData {
  id?: number;
  property_name: string;
  primary_color: string;
  logo_url: string | null;
  official_email: string;
  support_phone: string;
  registered_address: string;
  pan_vat_number: string;
  /** PPPoE-only deployment: hotspot/voucher UI is hidden and its API rejected. */
  pppoe_only: boolean;
}

interface BrandingContextType {
  branding: BrandingData;
  loading: boolean;
  updateBrandingState: (data: Partial<BrandingData>) => void;
  refreshBranding: () => Promise<void>;
}

// Last known service mode, so a PPPoE-only system doesn't flash hotspot UI while the
// branding request is still in flight.
const CACHE_KEY = 'airlink_pppoe_only';
const cachedPppoeOnly = (): boolean => {
  try { return localStorage.getItem(CACHE_KEY) === '1'; } catch { return false; }
};

const defaultBranding: BrandingData = {
  property_name: 'Airlink',
  primary_color: '#1e3a5f',
  logo_url: null,
  official_email: 'oxygen@gmail.com',
  support_phone: '+9779851129935',
  registered_address: 'kathmandu Barnani',
  pan_vat_number: '601234567',
  pppoe_only: cachedPppoeOnly(),
};

const BrandingContext = createContext<BrandingContextType>({
  branding: defaultBranding,
  loading: false,
  updateBrandingState: () => {},
  refreshBranding: async () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingData>(defaultBranding);
  const [loading, setLoading] = useState(true);

  const applyFaviconAndTitle = (data: BrandingData) => {
    if (data.property_name) {
      document.title = `${data.property_name} Billing v3.0`;
    }

    if (data.logo_url) {
      let favicon = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'shortcut icon';
        document.head.appendChild(favicon);
      }
      favicon.href = data.logo_url;
    }

    try { localStorage.setItem(CACHE_KEY, data.pppoe_only ? '1' : '0'); } catch { /* storage unavailable */ }

    if (data.primary_color) {
      document.documentElement.style.setProperty('--brand-primary', data.primary_color);
    }
  };

  const refreshBranding = async () => {
    try {
      const res = await api.get('/settings/branding');
      if (res.data) {
        const data = res.data;
        setBranding(data);
        applyFaviconAndTitle(data);
      }
    } catch (err) {
      console.error('Failed to fetch branding settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshBranding();
  }, []);

  const updateBrandingState = (data: Partial<BrandingData>) => {
    setBranding((prev) => {
      const updated = { ...prev, ...data };
      applyFaviconAndTitle(updated);
      return updated;
    });
  };

  return (
    <BrandingContext.Provider value={{ branding, loading, updateBrandingState, refreshBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);
