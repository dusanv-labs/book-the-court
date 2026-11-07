import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button, Card, ErrorMessage, Field, inputClass, SlowNotice } from '../../components/ui';
import { useI18n } from '../../i18n/context';
import { api, errorText } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

interface Values {
  email: string;
  password: string;
}

export function LoginPage() {
  const { m } = useI18n();
  const { token, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/admin';
  const schema = useMemo(
    () => z.object({ email: z.email(m.admin.errEmail), password: z.string().min(1, m.admin.errPassword) }),
    [m],
  );
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const demoEmail = import.meta.env.VITE_DEMO_EMAIL;
  const demoPassword = import.meta.env.VITE_DEMO_PASSWORD;
  const mutation = useMutation({
    mutationFn: (v: Values) => api.login(v.email, v.password),
    onSuccess: ({ accessToken }) => {
      login(accessToken);
      navigate(from, { replace: true });
    },
  });

  if (token) return <Navigate to="/admin" replace />;

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-3xl font-bold">{m.admin.loginTitle}</h1>
      {demoEmail && demoPassword && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">{m.admin.demoTitle}</p>
          <p className="mt-1">
            {m.admin.demoLogin} <span className="font-mono">{demoEmail}</span> / <span className="font-mono">{demoPassword}</span>
          </p>
          <p className="mt-1 text-emerald-800">{m.admin.demoReset}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              setValue('email', demoEmail, { shouldValidate: true });
              setValue('password', demoPassword, { shouldValidate: true });
            }}
          >
            {m.admin.demoFill}
          </Button>
        </div>
      )}
      <Card>
        <form className="space-y-4" onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
          <Field label={m.admin.email} error={errors.email?.message}>
            <input className={inputClass} type="email" autoComplete="username" aria-invalid={!!errors.email} {...register('email')} />
          </Field>
          <Field label={m.admin.password} error={errors.password?.message}>
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
          </Field>
          {mutation.isError && <ErrorMessage>{errorText(mutation.error, m.errors)}</ErrorMessage>}
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? m.admin.signingIn : m.admin.signIn}
          </Button>
          {mutation.isPending && <SlowNotice />}
        </form>
      </Card>
    </div>
  );
}
