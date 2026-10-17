import { useEffect, useState } from 'react';
import type { AccountState } from '../components/AccountSettings.types';

export function useAccount() {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const off = window.localflow.onAccountState<AccountState>(value => { if (active) { setAccount(value); setError(''); } });
    void window.localflow.accountCall<AccountState>('status').then(value => { if (active) setAccount(value); }).catch(failure => { if (active) setError(String(failure)); });
    return () => { active = false; off(); };
  }, []);
  return { account, error };
}
