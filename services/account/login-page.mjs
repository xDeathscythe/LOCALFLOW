const escape = text => String(text).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));

export function loginPage({ publishableKey, requestId, origin, nonce }) {
  const domain = Buffer.from(publishableKey.split('_').slice(2).join('_'), 'base64').toString().replace(/\$$/, '');
  if (!/^[a-zA-Z0-9.-]+$/.test(domain)) throw new Error('Invalid Clerk publishable key.');
  const returnUrl = `${origin}/connect?request=${encodeURIComponent(requestId)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect LocalFlow</title>
  <style nonce="${nonce}">body{font:16px system-ui;background:#10171a;color:#eaf5ef;display:grid;place-items:center;min-height:95vh}main{max-width:430px;padding:24px}p{line-height:1.6;color:#b8cdc4}button{font:inherit;padding:10px 18px;border-radius:9px;border:0;cursor:pointer}#error{color:#ffb6ae}</style>
  <script nonce="${nonce}" defer crossorigin="anonymous" src="https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js"></script>
  <script nonce="${nonce}" defer crossorigin="anonymous" data-clerk-publishable-key="${escape(publishableKey)}" src="https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js"></script></head>
  <body><main><h1>Connect LocalFlow</h1><p>Use your Google account for your profile and meeting calendar. Notes and recordings stay on your computer. Remote access is a separate setting.</p><div id="signin"></div><p id="account"></p><p><label><input id="calendar" type="checkbox" checked> Include meeting calendar</label></p><button id="continue" hidden>Connect this device</button><button id="switch" hidden>Use another account</button><p id="error" role="alert"></p></main>
  <script nonce="${nonce}">
  window.addEventListener('load', async () => {
    const error = document.querySelector('#error'), button = document.querySelector('#continue'), swap = document.querySelector('#switch');
    const redirectUrl = ${JSON.stringify(returnUrl)};
    try {
      await Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
      const signed = () => {
        if (!Clerk.session) return;
        document.querySelector('#signin').hidden = true;
        document.querySelector('#account').textContent = Clerk.user?.primaryEmailAddress?.emailAddress || 'Signed in';
        button.hidden = false; swap.hidden = false;
      };
      Clerk.addListener(signed);
      if (Clerk.session) signed();
      else Clerk.mountSignIn(document.querySelector('#signin'), { forceRedirectUrl: redirectUrl, signUpForceRedirectUrl: redirectUrl });
      swap.onclick = () => Clerk.signOut({ redirectUrl });
      button.onclick = async () => {
        button.disabled = true; error.textContent = '';
        try {
          const additionalScopes = ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
          const account = Clerk.user.externalAccounts.find(item => item.provider === 'google');
          const approved = new Set((account?.approvedScopes || '').split(' '));
          if (document.querySelector('#calendar').checked && additionalScopes.some(scope => !approved.has(scope))) {
            const linked = account ? await account.reauthorize({ additionalScopes, redirectUrl }) : await Clerk.user.createExternalAccount({ strategy: 'oauth_google', additionalScopes, redirectUrl });
            const verification = linked.verification?.externalVerificationRedirectURL;
            if (!verification) throw new Error('Google did not return an authorization address. You can continue without calendar by clearing its checkbox.');
            location.assign(verification.href); return;
          }
          const response = await fetch('/v1/login/complete', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await Clerk.session.getToken() }, body: JSON.stringify({ requestId: ${JSON.stringify(requestId)} }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          location.assign(result.redirectUri);
        } catch (failure) { error.textContent = failure.message; button.disabled = false; }
      };
    } catch { error.textContent = 'Sign-in could not load. Please retry from LocalFlow.'; }
  });</script></body></html>`;
}
