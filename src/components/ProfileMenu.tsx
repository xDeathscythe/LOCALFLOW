import { UserRound } from 'lucide-react';
import type { ReactNode } from 'react';

export function ProfileMenu({ children, version }: { children: ReactNode; version: string }) {
  return <div className="profileMenu">
    <button className="profileTrigger" popoverTarget="profile-menu" aria-label="Open profile menu" title="Profile">
      <UserRound size={18} />
    </button>
    <div id="profile-menu" className="profilePopover" popover="auto">
      <nav aria-label="Profile and preferences">{children}</nav>
      <button className="profileIdentity" popoverTarget="profile-menu" popoverTargetAction="hide" aria-label="Close profile menu"><UserRound size={18} /><span>Local workspace<small>Version {version}</small></span></button>
    </div>
  </div>;
}
