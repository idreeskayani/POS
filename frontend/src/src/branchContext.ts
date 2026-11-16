import { createContext, useContext } from 'react';
import type { Branch } from './types';

export const BranchCtx = createContext<{ branch: Branch; reload: () => void } | null>(null);
export const useBranch = () => {
  const v = useContext(BranchCtx);
  if (!v) throw new Error('useBranch outside provider');
  return v;
};
