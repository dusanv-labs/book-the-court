export type Sport = 'PADEL' | 'TENNIS' | 'FOOTBALL';
export type DayType = 'WEEKDAY' | 'WEEKEND';
export type SlotStatus = 'free' | 'booked' | 'blocked' | 'past';
export type BookingStatus = 'CONFIRMED' | 'CANCELLED';

export const SPORTS: { value: Sport; label: string; icon: string }[] = [
  { value: 'PADEL', label: 'Padel', icon: '🏓' },
  { value: 'TENNIS', label: 'Tennis', icon: '🎾' },
  { value: 'FOOTBALL', label: 'Football', icon: '⚽' },
];

export const sportLabel = (s: Sport) => SPORTS.find((x) => x.value === s)?.label ?? s;

export interface Slot {
  startsAt: string;
  endsAt: string;
  status: SlotStatus;
}

export interface AvailabilityCourt {
  id: string;
  name: string;
  indoor: boolean;
  slots: Slot[];
}

export interface PriceBand {
  dayType: DayType;
  startMinute: number;
  endMinute: number;
  pricePerHour: number;
}

export interface Availability {
  date: string;
  sport: Sport;
  timezone: string;
  slotMinutes: number;
  durations: number[];
  currency: string;
  hours: { openMinute: number; closeMinute: number } | null;
  prices: PriceBand[];
  courts: AvailabilityCourt[];
}

export interface Quote {
  price: number;
  currency: string;
  startsAt: string;
  endsAt: string;
}

export interface BookingResult {
  code: string;
  cancelToken: string;
  court: { id: string; name: string; sport: Sport };
  startsAt: string;
  endsAt: string;
  price: number;
  currency: string;
}

export interface ManagedBooking {
  code: string;
  court: { name: string; sport: Sport };
  startsAt: string;
  endsAt: string;
  price: number;
  currency: string;
  status: BookingStatus;
  customerName: string;
  canCancel: boolean;
  cancelCutoffMinutes: number;
}

export interface Court {
  id: string;
  name: string;
  sport: Sport;
  indoor: boolean;
  active: boolean;
  sortOrder: number;
}

export interface OpeningHours {
  dayOfWeek: number;
  openMinute: number;
  closeMinute: number;
  closed: boolean;
}

export interface PriceRule extends PriceBand {
  id?: string;
  sport: Sport;
}

export interface AdminBooking {
  id: string;
  code: string;
  startsAt: string;
  endsAt: string;
  price: number;
  status: BookingStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  createdAt: string;
  court: { id: string; name: string; sport: Sport };
}

export interface Block {
  id: string;
  courtId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string;
  court: { id: string; name: string } | null;
}
