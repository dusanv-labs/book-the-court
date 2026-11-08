import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { Button } from '../../components/ui';
import { useI18n } from '../../i18n/context';
import { useAuth } from '../../lib/auth-context';

export function AdminLayout() {
  const { m } = useI18n();
  const { token, logout } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;

  const tabs = [
    { to: '/admin', label: m.admin.tabs.bookings, end: true },
    { to: '/admin/new', label: `+ ${m.admin.tabs.newBooking}` },
    { to: '/admin/courts', label: m.admin.tabs.courts },
    { to: '/admin/schedule', label: m.admin.tabs.schedule },
    { to: '/admin/blocks', label: m.admin.tabs.blocks },
    { to: '/admin/reports', label: m.admin.tabs.reports },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-3xl font-bold tracking-tight">{m.admin.title}</h1>
        <Button variant="secondary" onClick={logout}>
          {m.admin.logout}
        </Button>
      </div>
      <nav className="-mx-4 overflow-x-auto px-4 print:hidden" aria-label={m.admin.title}>
        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
                  isActive ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
