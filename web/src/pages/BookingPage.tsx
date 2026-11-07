import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { SlotBrowser } from '../components/SlotBrowser';
import { useI18n } from '../i18n/context';

export function BookingPage() {
  const { m } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{m.booking.title}</h1>
        <p className="mt-2 max-w-2xl text-slate-600">{m.booking.intro}</p>
      </section>
      <SlotBrowser
        rememberCustomer
        onBooked={(result) => {
          void queryClient.invalidateQueries({ queryKey: ['availability'] });
          navigate('/confirmed', { state: result });
        }}
      />
    </div>
  );
}
