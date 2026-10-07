const status = document.querySelector('#status'), form = document.querySelector('#pair'), disconnect = document.querySelector('#disconnect');
async function send(message) { const reply = await chrome.runtime.sendMessage(message); if (reply.error) throw new Error(reply.error); return reply.value; }
function show(value) { status.textContent = value.lastError || (value.paired ? 'Connected to LocalFlow.' : 'Connect LocalFlow to detect browser calls.'); disconnect.hidden = !value.paired; }
send({ type: 'status' }).then(show).catch(error => { status.textContent = error.message; });
form.addEventListener('submit', async event => { event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
  try { show(await send({ type: 'pair', code: document.querySelector('#code').value.trim() })); document.querySelector('#code').value = ''; }
  catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
});
disconnect.addEventListener('click', () => { send({ type: 'disconnect' }).then(show).catch(error => { status.textContent = error.message; }); });
