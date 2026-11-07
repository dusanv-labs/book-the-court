import { Link, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { useI18n } from './i18n/context';
import { AdminLayout } from './pages/admin/AdminLayout';
import { BlocksAdminPage } from './pages/admin/BlocksAdminPage';
import { BookingsAdminPage } from './pages/admin/BookingsAdminPage';
import { CourtsAdminPage } from './pages/admin/CourtsAdminPage';
import { LoginPage } from './pages/admin/LoginPage';
import { NewBookingAdminPage } from './pages/admin/NewBookingAdminPage';
import { ScheduleAdminPage } from './pages/admin/ScheduleAdminPage';
import { BookingPage } from './pages/BookingPage';
import { ConfirmationPage } from './pages/ConfirmationPage';
import { ManagePage } from './pages/ManagePage';

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
        <Route path="admin/login" element={<LoginPage />} />
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<BookingsAdminPage />} />
          <Route path="new" element={<NewBookingAdminPage />} />
          <Route path="courts" element={<CourtsAdminPage />} />
          <Route path="schedule" element={<ScheduleAdminPage />} />
          <Route path="blocks" element={<BlocksAdminPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
