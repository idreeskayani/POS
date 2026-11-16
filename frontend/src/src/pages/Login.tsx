import { FormEvent, useState } from 'react';
import { api, saveAuth, Auth } from '../api';
import { setUser, useAppDispatch } from '../store';

export default function Login() {
  const dispatch = useAppDispatch();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ orgName: '', branchName: '', branchCode: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = mode === 'login' ? { email: f.email, password: f.password } : f;
      const auth = await api<Auth>(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body });
      saveAuth(auth);
      dispatch(setUser(auth.user));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>Restaurant POS</h1>
        <p className="muted">{mode === 'login' ? 'Sign in to continue' : 'Create your restaurant account'}</p>
        {mode === 'register' && (
          <>
            <input placeholder="Restaurant name" value={f.orgName} onChange={set('orgName')} required />
            <div className="row">
              <input placeholder="First branch name" value={f.branchName} onChange={set('branchName')} required />
              <input placeholder="Code (e.g. BR1)" value={f.branchCode} onChange={set('branchCode')} required maxLength={8} />
            </div>
            <input placeholder="Your name" value={f.name} onChange={set('name')} required />
          </>
        )}
        <input type="email" placeholder="Email" value={f.email} onChange={set('email')} required />
        <input type="password" placeholder="Password (min 8 characters)" value={f.password} onChange={set('password')} required minLength={8} />
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'New restaurant? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
