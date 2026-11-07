import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { Button } from '../../components/ui';
import { useAuth } from '../../lib/auth-context';

const tabs = [
  { to: '/admin', label: 'Bookings', end: true },
  { to: '/admin/courts', label: 'Courts' },
  { to: '/admin/schedule', label: 'Hours & prices' },
  { to: '/admin/blocks', label: 'Blocked time' },
];

export function AdminLayout() {
  const { token, logout } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Venue admin</h1>
        <Button variant="secondary" onClick={logout}>
          Log out
        </Button>
      </div>
      <nav className="-mx-4 overflow-x-auto px-4" aria-label="Admin">
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

