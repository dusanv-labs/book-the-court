/** Optionally remembers the customer's contact details on this device ("Remember my details"). */
export interface CustomerDetails {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

const KEY = 'btc_customer';

export function loadCustomer(): CustomerDetails | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CustomerDetails>;
    if (typeof data.customerName !== 'string' || typeof data.customerEmail !== 'string' || typeof data.customerPhone !== 'string') {
      return null;
    }
    return data as CustomerDetails;
  } catch {
    return null;
  }
}

export function saveCustomer(details: CustomerDetails | null) {
  try {
    if (details) localStorage.setItem(KEY, JSON.stringify(details));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: nothing to remember */
  }
}
