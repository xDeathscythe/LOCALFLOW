void window.__TAURI__.event.listen('desktop-request', async ({payload}) => {
  try {
    const methods = ['offer','answer','ready','startResponse','result'];
    if (!methods.includes(payload.method)) throw new Error('Unknown cleanup operation.');
    const operation = window.cleanupTransport[payload.method];
    const value = await (typeof operation === 'function' ? operation(payload.args) : operation);
    await window.__TAURI__.core.invoke('frontend_reply', { id:payload.id, value:value ?? null, error:null });
  } catch (error) { await window.__TAURI__.core.invoke('frontend_reply', { id:payload.id, value:null, error:String(error) }); }
}).then(()=>window.__TAURI__.core.invoke('frontend_reply',{id:window.__LOCALFLOW_READY_ID,value:true,error:null}));
