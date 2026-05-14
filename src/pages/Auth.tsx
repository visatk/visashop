import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <AuthFrame title="Welcome back" sub={<>New here? <Link to="/register" className="text-(--color-accent)">Create an account</Link></>}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await login(email, password);
            const next = (loc.state as { from?: string } | null)?.from ?? '/account';
            navigate(next, { replace: true });
          } catch (err) {
            toast.push((err as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <label className="block text-sm">Email
          <input type="email" required autoComplete="email" className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">Password
          <input type="password" required autoComplete="current-password" className="input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="text-xs text-center text-(--color-muted)">
          <Link to="/forgot" className="hover:text-(--color-accent)">Forgot password?</Link>
        </div>
      </form>
    </AuthFrame>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <AuthFrame title="Create your account" sub={<>Already have one? <Link to="/login" className="text-(--color-accent)">Sign in</Link></>}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await register(email, password, name || undefined);
            navigate('/account', { replace: true });
          } catch (err) {
            toast.push((err as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <label className="block text-sm">Name (optional)
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">Email
          <input type="email" required autoComplete="email" className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">Password
          <input type="password" required minLength={8} autoComplete="new-password" className="input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="text-xs text-(--color-muted) mt-1 block">At least 8 characters.</span>
        </label>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <AuthFrame title="Reset your password" sub="Enter your email and we'll send you a reset link.">
      {sent ? (
        <p className="text-sm">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api.post('/api/auth/password/request', { email });
              setSent(true);
            } catch (err) {
              toast.push((err as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-3"
        >
          <label className="block text-sm">Email
            <input type="email" required className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPassword() {
  const toast = useToast();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <AuthFrame title="Set a new password" sub="Use a strong password you don't reuse anywhere else.">
      {done ? (
        <p className="text-sm">
          Password updated. <Link to="/login" className="text-(--color-accent)">Sign in</Link>.
        </p>
      ) : !token ? (
        <p className="text-sm text-(--color-danger)">
          This reset link is invalid. <Link to="/forgot" className="text-(--color-accent)">Request a new one</Link>.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api.post('/api/auth/password/reset', { token, password });
              setDone(true);
            } catch (err) {
              toast.push((err as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-3"
        >
          <label className="block text-sm">
            New password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}

function AuthFrame({ title, sub, children }: { title: string; sub: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card p-7">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-(--color-muted) text-sm mt-1">{sub}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
