import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { useBranch } from '../branchContext';
import { useAppSelector } from '../store';
import type { Branch, Category, Role, Table } from '../types';
import { fmt } from '../util';

type Tab = 'menu' | 'tables' | 'staff' | 'branches';

export default function Admin() {
  const role = useAppSelector((s) => s.auth.user!.role);
  const orgWide = role === 'OWNER' || role === 'ADMIN';
  const [tab, setTab] = useState<Tab>('menu');
  return (
    <div className="admin">
      <div className="tabs">
        <button className={tab === 'menu' ? 'tab active' : 'tab'} onClick={() => setTab('menu')}>Menu</button>
        <button className={tab === 'tables' ? 'tab active' : 'tab'} onClick={() => setTab('tables')}>Tables</button>
        <button className={tab === 'staff' ? 'tab active' : 'tab'} onClick={() => setTab('staff')}>Staff</button>
        {orgWide && <button className={tab === 'branches' ? 'tab active' : 'tab'} onClick={() => setTab('branches')}>Branches</button>}
      </div>
      {tab === 'menu' && <MenuAdmin canEdit={orgWide} />}
      {tab === 'tables' && <TablesAdmin />}
      {tab === 'staff' && <StaffAdmin />}
      {tab === 'branches' && orgWide && <BranchesAdmin />}
    </div>
  );
}

function useAction() {
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); } catch (e: any) { setError(e.message); }
  };
  return { error, run };
}

function MenuAdmin({ canEdit }: { canEdit: boolean }) {
  const { branch } = useBranch();
  const [menu, setMenu] = useState<Category[]>([]);
  const [catName, setCatName] = useState('');
  const [item, setItem] = useState({ categoryId: '', name: '', basePrice: '' });
  const { error, run } = useAction();
  const load = () => api<Category[]>(`/menu?branchId=${branch.id}`).then(setMenu);
  useEffect(() => { load().catch(() => {}); }, [branch.id]);

  const addCategory = (e: FormEvent) => {
    e.preventDefault();
    run(async () => { await api('/menu/categories', { method: 'POST', body: { name: catName, sortOrder: menu.length } }); setCatName(''); await load(); });
  };
  const addItem = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/menu/items', { method: 'POST', body: { categoryId: item.categoryId || menu[0]?.id, name: item.name, basePrice: Number(item.basePrice) } });
      setItem({ ...item, name: '', basePrice: '' });
      await load();
    });
  };
  const toggle = (id: string, isAvailable: boolean) =>
    run(async () => { await api(`/menu/branches/${branch.id}/items/${id}`, { method: 'PUT', body: { isAvailable } }); await load(); });
  const setPrice = (id: string) => {
    const v = prompt(`New price for ${branch.name} (leave empty to reset to base price)`);
    if (v === null) return;
    run(async () => { await api(`/menu/branches/${branch.id}/items/${id}`, { method: 'PUT', body: { price: v === '' ? null : Number(v) } }); await load(); });
  };

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {canEdit && (
        <div className="forms">
          <form className="card row" onSubmit={addCategory}>
            <input className="grow" placeholder="New category (e.g. Burgers)" value={catName} onChange={(e) => setCatName(e.target.value)} required />
            <button className="primary">Add category</button>
          </form>
          <form className="card row" onSubmit={addItem}>
            <select value={item.categoryId} onChange={(e) => setItem({ ...item, categoryId: e.target.value })}>
              {menu.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="grow" placeholder="Item name" value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} required />
            <input type="number" min={0} placeholder="Price" value={item.basePrice} onChange={(e) => setItem({ ...item, basePrice: e.target.value })} required />
            <button className="primary" disabled={!menu.length}>Add item</button>
          </form>
        </div>
      )}
      {menu.map((c) => (
        <div key={c.id} className="card block">
          <h3>{c.name}</h3>
          {c.items.length === 0 && <p className="muted">No items.</p>}
          {c.items.map((i) => (
            <div key={i.id} className="row item-row">
              <span className="grow">{i.name}</span>
              <span>{fmt(i.price, branch.currency)}</span>
              <button className="ghost" onClick={() => setPrice(i.id)}>Set branch price</button>
              <button className={i.isAvailable ? '' : 'danger'} onClick={() => toggle(i.id, !i.isAvailable)}>
                {i.isAvailable ? 'Available' : 'Unavailable'}
              </button>
            </div>
          ))}
        </div>
      ))}
      <p className="muted small">Menu items are shared by all branches. Price and availability changes here apply to {branch.name} only.</p>
    </div>
  );
}

function TablesAdmin() {
  const { branch } = useBranch();
  const [tables, setTables] = useState<Table[]>([]);
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState('4');
  const { error, run } = useAction();
  const load = () => api<Table[]>(`/branches/${branch.id}/tables`).then(setTables);
  useEffect(() => { load().catch(() => {}); }, [branch.id]);
  const add = (e: FormEvent) => {
    e.preventDefault();
    run(async () => { await api(`/branches/${branch.id}/tables`, { method: 'POST', body: { label, seats: Number(seats) } }); setLabel(''); await load(); });
  };
  return (
    <div>
      {error && <div className="error">{error}</div>}
      <form className="card row" onSubmit={add}>
        <input className="grow" placeholder="Table label (e.g. T1)" value={label} onChange={(e) => setLabel(e.target.value)} required />
        <input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} title="Seats" />
        <button className="primary">Add table</button>
      </form>
      <div className="grid small-grid">
        {tables.map((t) => (
          <div key={t.id} className={`card table-card ${t.status}`}>
            <strong>{t.label}</strong>
            <span className="muted">{t.seats} seats · {t.status.toLowerCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffAdmin() {
  const { branch } = useBranch();
  const me = useAppSelector((s) => s.auth.user!);
  const [users, setUsers] = useState<any[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'CASHIER' as Role, branchId: branch.id });
  const { error, run } = useAction();
  const load = () => api<any[]>('/users').then(setUsers);
  useEffect(() => { load().catch(() => {}); api<Branch[]>('/branches').then(setBranches).catch(() => {}); }, []);
  useEffect(() => setF((p) => ({ ...p, branchId: branch.id })), [branch.id]);
  const roles: Role[] = me.role === 'ADMIN' ? ['ADMIN', 'CASHIER', 'WAITER'] : ['OWNER', 'ADMIN', 'CASHIER', 'WAITER'];
  const orgLevel = f.role === 'OWNER' || f.role === 'ADMIN';
  const add = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/users', { method: 'POST', body: { ...f, branchId: orgLevel ? undefined : f.branchId } });
      setF({ ...f, name: '', email: '', password: '' });
      await load();
    });
  };
  const bname = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? '—' : 'All branches');
  return (
    <div>
      {error && <div className="error">{error}</div>}
      <form className="card row wrap" onSubmit={add}>
        <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <input type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        <input type="password" placeholder="Password (min 8)" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{roles.map((r) => <option key={r}>{r}</option>)}</select>
        {!orgLevel && (
          <select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <button className="primary">Add staff</button>
      </form>
      <div className="card block">
        {users.map((u) => (
          <div key={u.id} className="row item-row">
            <span className="grow">{u.name} <span className="muted">· {u.email}</span></span>
            <span className={`badge ${u.role}`}>{u.role}</span>
            <span className="muted">{bname(u.branchId)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BranchesAdmin() {
  const { reload } = useBranch();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [f, setF] = useState({ name: '', code: '', address: '', taxRate: '0' });
  const { error, run } = useAction();
  const load = () => api<Branch[]>('/branches').then(setBranches);
  useEffect(() => { load().catch(() => {}); }, []);
  const add = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/branches', { method: 'POST', body: { name: f.name, code: f.code.toUpperCase(), address: f.address || undefined, taxRate: Number(f.taxRate) } });
      setF({ name: '', code: '', address: '', taxRate: '0' });
      await load(); reload();
    });
  };
  const save = (b: Branch, patch: Partial<Branch>) =>
    run(async () => { await api(`/branches/${b.id}`, { method: 'PATCH', body: patch }); await load(); reload(); });
  return (
    <div>
      {error && <div className="error">{error}</div>}
      <form className="card row wrap" onSubmit={add}>
        <input placeholder="Branch name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <input placeholder="Code (BR2)" maxLength={8} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
        <input className="grow" placeholder="Address (optional)" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        <input type="number" min={0} max={100} step="0.01" title="Tax %" value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} />
        <button className="primary">Add branch</button>
      </form>
      <div className="card block">
        {branches.map((b) => (
          <div key={b.id} className="row item-row">
            <span className="grow"><strong>{b.name}</strong> <span className="muted">· {b.code}</span></span>
            <label className="muted small">Tax %</label>
            <input className="mini num" type="number" min={0} max={100} step="0.01" defaultValue={b.taxRate}
              onBlur={(e) => Number(e.target.value) !== b.taxRate && save(b, { taxRate: Number(e.target.value) })} />
            <label className="muted small">Currency</label>
            <input className="mini" defaultValue={b.currency} maxLength={5}
              onBlur={(e) => e.target.value && e.target.value !== b.currency && save(b, { currency: e.target.value.toUpperCase() })} />
          </div>
        ))}
        <p className="muted small">Tax and currency save when you leave the field.</p>
      </div>
    </div>
  );
}
