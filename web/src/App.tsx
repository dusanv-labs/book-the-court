import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useI18n } from './i18n/context';
import { BookingPage } from './pages/BookingPage';
import { ConfirmationPage } from './pages/ConfirmationPage';
import { ManagePage } from './pages/ManagePage';

// Admin pages are loaded only when an admin opens them, so players download less.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((mod) => ({ default: mod[name] })));
const AdminLayout = named(() => import('./pages/admin/AdminLayout'), 'AdminLayout');
const LoginPage = named(() => import('./pages/admin/LoginPage'), 'LoginPage');
const BookingsAdminPage = named(() => import('./pages/admin/BookingsAdminPage'), 'BookingsAdminPage');
const NewBookingAdminPage = named(() => import('./pages/admin/NewBookingAdminPage'), 'NewBookingAdminPage');
const CourtsAdminPage = named(() => import('./pages/admin/CourtsAdminPage'), 'CourtsAdminPage');
const ScheduleAdminPage = named(() => import('./pages/admin/ScheduleAdminPage'), 'ScheduleAdminPage');
const BlocksAdminPage = named(() => import('./pages/admin/BlocksAdminPage'), 'BlocksAdminPage');
const ReportsAdminPage = named(() => import('./pages/admin/ReportsAdminPage'), 'ReportsAdminPage');

function Loading({ children }: { children: ReactNode }) {
  const { m } = useI18n();
  return <Suspense fallback={<Spinner label={m.common.loading} />}>{children}</Suspense>;
}

function NotFound() {
  const { m } = useI18n();
  return (
    <div className="py-16 text-center">
      <h1 className="text-3xl font-bold">{m.notFound.title}</h1>
      <Link to="/" className="mt-4 inline-block font-semibold text-emerald-700 hover:underline">
        {m.notFound.link}
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<BookingPage />} />
        <Route path="confirmed" element={<ConfirmationPage />} />
        <Route path="manage/:token" element={<ManagePage />} />
        <Route path="admin/login" element={<Loading><LoginPage /></Loading>} />
        <Route path="admin" element={<Loading><AdminLayout /></Loading>}>
          <Route index element={<Loading><BookingsAdminPage /></Loading>} />
          <Route path="new" element={<Loading><NewBookingAdminPage /></Loading>} />
          <Route path="courts" element={<Loading><CourtsAdminPage /></Loading>} />
          <Route path="schedule" element={<Loading><ScheduleAdminPage /></Loading>} />
          <Route path="blocks" element={<Loading><BlocksAdminPage /></Loading>} />
          <Route path="reports" element={<Loading><ReportsAdminPage /></Loading>} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
