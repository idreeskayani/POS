import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api, saveAuth } from './api';
import { BranchCtx } from './branchContext';
import Admin from './pages/Admin';
import Kitchen from './pages/Kitchen';
import Login from './pages/Login';
import Pos from './pages/Pos';
import { setBranch, setUser, useAppDispatch, useAppSelector } from './store';
import type { Branch } from './types';

export default function App() {
  const user = useAppSelector((s) => s.auth.user);
  return user ? (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  ) : (
    <Login />
  );
}

function Shell() {
  const user = useAppSelector((s) => s.auth.user)!;
  const branchId = useAppSelector((s) => s.branch.id);
  const dispatch = useAppDispatch();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api<Branch[]>('/branches').then(setBranches).catch((e) => setError(e.message));
  }, []);
  useEffect(reload, [reload]);

  // Pick a valid branch: own branch for branch-level users, otherwise remembered/first.
  useEffect(() => {
    if (!branches.length) return;
    const wanted = user.branchId ?? branchId;
    const valid = branches.find((b) => b.id === wanted) ?? branches[0];
    if (valid.id !== branchId) dispatch(setBranch(valid.id));
  }, [branches, user.branchId, branchId, dispatch]);

  const branch = branches.find((b) => b.id === branchId);
  const isKitchen = user.role === 'KITCHEN';
  const canAdmin = ['OWNER', 'ADMIN', 'MANAGER'].includes(user.role);
  const home = isKitchen ? '/kitchen' : '/pos';

  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    saveAuth(null);
    dispatch(setUser(null));
  };

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">POS</strong>
        <nav>
          {!isKitchen && <NavLink to="/pos">Cashier</NavLink>}
          <NavLink to="/kitchen">Kitchen</NavLink>
          {canAdmin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="spacer" />
        {user.branchId === null && branches.length > 1 ? (
          <select value={branchId ?? ''} onChange={(e) => dispatch(setBranch(e.target.value))}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : (
          <span className="muted">{branch?.name}</span>
        )}
        <span className="muted">{user.name} · {user.role}</span>
        <button className="ghost" onClick={logout}>Log out</button>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {!branch ? (
          <p className="muted pad">Loading branch…</p>
        ) : (
          <BranchCtx.Provider value={{ branch, reload }}>
            <Routes>
              {!isKitchen && <Route path="/pos" element={<Pos />} />}
              <Route path="/kitchen" element={<Kitchen />} />
              {canAdmin && <Route path="/admin" element={<Admin />} />}
              <Route path="*" element={<Navigate to={home} replace />} />
            </Routes>
          </BranchCtx.Provider>
        )}
      </main>
    </div>
  );
}
