import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { AssistantWidget } from '../components/AssistantWidget';
import { SlotBrowser } from '../components/SlotBrowser';
import { useI18n } from '../i18n/context';
import type { BookingResult } from '../lib/types';

export function BookingPage() {
  const { m } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onBooked = (result: BookingResult) => {
    void queryClient.invalidateQueries({ queryKey: ['availability'] });
    navigate('/confirmed', { state: result });
  };

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{m.booking.title}</h1>
        <p className="mt-2 max-w-2xl text-slate-600">{m.booking.intro}</p>
      </section>
      <SlotBrowser rememberCustomer onBooked={onBooked} />
      <AssistantWidget onBooked={onBooked} />
    </div>
  );
}
