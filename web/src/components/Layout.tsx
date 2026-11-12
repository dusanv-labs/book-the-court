import { Link, NavLink, Outlet } from 'react-router';
import { useI18n } from '../i18n/context';
import type { Lang } from '../i18n/messages';
import { FeedbackProvider } from './FeedbackProvider';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-slate-900">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#059669" />
        <rect x="7" y="7" width="18" height="18" rx="1.5" fill="none" stroke="#fff" strokeWidth="2" />
        <path d="M16 7v18M7 16h18" stroke="#fff" strokeWidth="2" />
      </svg>
      <span className="hidden text-lg min-[480px]:inline">
        Book<span className="text-emerald-600">The</span>Court
      </span>
    </Link>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap sm:px-3 ${isActive ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'}`;

function LanguageSwitch() {
  const { lang, setLang, m } = useI18n();
  const options: Lang[] = ['en', 'sr'];
  return (
    <div role="group" aria-label={m.nav.language} className="flex rounded-lg border border-slate-200 p-0.5 text-xs font-semibold">
      {options.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={`rounded-md px-2 py-1 uppercase ${lang === l ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function Layout() {
  const { m } = useI18n();
  return (
    <FeedbackProvider>
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 print:bg-white">
        <header className="sticky top-0 z-30 border-b print:hidden border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
            <Logo />
            <div className="flex items-center gap-2">
              <nav className="flex gap-1" aria-label={m.nav.main}>
                <NavLink to="/" end className={navClass}>
                  {m.nav.book}
                </NavLink>
                <NavLink to="/admin" className={navClass}>
                  {m.nav.admin}
                </NavLink>
              </nav>
              <LanguageSwitch />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          <Outlet />
        </main>
        <footer className="border-t border-slate-200 bg-white print:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-sm text-slate-500 sm:flex-row sm:justify-between">
            <p>{m.footer.demo}</p>
            <p>
              {m.footer.by}{' '}
              <a className="font-medium text-emerald-700 hover:underline" href="https://dusanv-labs.github.io">
                Dušan Vasić
              </a>{' '}
              ·{' '}
              <a className="font-medium text-emerald-700 hover:underline" href="https://github.com/dusanv-labs/book-the-court">
                {m.footer.source}
              </a>
            </p>
          </div>
        </footer>
      </div>
    </FeedbackProvider>
  );
}
