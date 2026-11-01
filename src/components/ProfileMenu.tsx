import { UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAccount } from '../lib/use-account';

export function ProfileMenu({ children, version, onAccount }: { children: ReactNode; version: string; onAccount: () => void }) {
  const { account } = useAccount();
  return <div className="profileMenu">
    <button className="profileTrigger" popoverTarget="profile-menu" aria-label="Open profile menu" title="Profile">
      <UserRound size={18} />
    </button>
    <div id="profile-menu" className="profilePopover" popover="auto">
      <nav aria-label="Profile and preferences">{children}</nav>
      <button className="profileIdentity" popoverTarget="profile-menu" popoverTargetAction="hide" onClick={onAccount}><UserRound size={18} /><span>{account?.user?.name || account?.user?.email || 'Sign in to LocalFlow'}<small>{account?.user?.email || 'Profile, calendar and connected devices'}</small><small>Version {version}</small></span></button>
    </div>
  </div>;
}
