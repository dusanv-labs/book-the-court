import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { SlotBrowser } from '../../components/SlotBrowser';
import { useI18n } from '../../i18n/context';
import { useFeedback } from '../../lib/feedback-context';
import { toLocalDate } from '../../lib/time';

/** Lets the venue add bookings taken by phone or at the reception, using the same flow as customers. */
export function NewBookingAdminPage() {
  const { m } = useI18n();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{m.admin.newBookingTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{m.admin.newBookingIntro}</p>
      </div>
      <SlotBrowser
        rememberCustomer={false}
        onBooked={(result) => {
          toast(m.admin.bookingCreated(result.code));
          void queryClient.invalidateQueries({ queryKey: ['availability'] });
          void queryClient.invalidateQueries({ queryKey: ['admin-bookings'] });
          navigate(`/admin?date=${toLocalDate(result.startsAt)}`);
        }}
      />
    </div>
  );
}
