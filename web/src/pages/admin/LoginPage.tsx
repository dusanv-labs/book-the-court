import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button, Card, ErrorMessage, Field, inputClass, SlowNotice } from '../../components/ui';
import { api, errorText } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

const schema = z.object({
  email: z.email('Please enter a valid email'),
  password: z.string().min(1, 'Please enter your password'),
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const { token, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/admin';
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });
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
      <h1 className="mb-6 text-3xl font-bold">Admin login</h1>
      <Card>
        <form className="space-y-4" onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
          <Field label="Email" error={errors.email?.message}>
            <input className={inputClass} type="email" autoComplete="username" aria-invalid={!!errors.email} {...register('email')} />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
          </Field>
          {mutation.isError && <ErrorMessage>{errorText(mutation.error)}</ErrorMessage>}
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
          {mutation.isPending && <SlowNotice />}
        </form>
      </Card>
    </div>
  );
}
