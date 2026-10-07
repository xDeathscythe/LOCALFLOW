export interface AccountState {
  status: string;
  error: string;
  serviceUrl: string;
  configured: boolean;
  user: { id: string; name: string; email: string } | null;
  deviceId: string | null;
  hostId: string;
  workspaceId: string;
  name: string;
  devices: { id: string; name: string; revoked: boolean; current: boolean }[];
  computers: { id: string; name: string; online: boolean; enabled: boolean }[];
  calendar: { enabled: boolean; status: string; error: string; calendars: { id: string; summary: string; primary: boolean }[]; selected: string[]; lastSync?: string };
  upcoming: { id: string; calendarId: string; summary?: string; start: { dateTime: string }; end: { dateTime: string } }[];
  remote: { enabled: boolean; status: string; error: string; endpoint: string; managedAvailable: boolean; cloudflaredPath: string };
}
export interface AccountSettingsProps {
  call: (action: string, value?: Record<string, unknown>) => Promise<unknown>;
  onState?: (listener: (state: AccountState) => void) => (() => void);
}
