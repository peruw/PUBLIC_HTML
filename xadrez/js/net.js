// Partida online por código de sala.
// Transporte: canal em tempo real do Supabase do site (broadcast + presença; não usa banco de dados).
// Para testes ou duas abas no mesmo aparelho: ?net=local usa BroadcastChannel.
// Mensagens do jogo (payload): { t, from, to?, ... }; t = 'join' | 'start' | 'started' | 'full' | 'move' | 'ack' |
// 'sync?' | 'state' | 'rematch?' | 'rematch-ok' | 'rematch-no' | 'resign' | 'resign-ok' | 'bye'.
// `from` é o id da aba (fixo enquanto a aba existir, mesmo recarregando); `to` restringe a um destinatário.

const SUPABASE = {
  // Chave pública (publishable) do projeto do site — a mesma de /conta/config.mjs. Não é segredo.
  url: 'https://rnbyvrzarzvkvixtxoli.supabase.co',
  anonKey: 'sb_publishable_KSX31Bo5Gn8CQUL6KTWNBg_2ncUCCxy',
  cdn: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm',
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O/0, I/1

export function newRoomCode() {
  let s = '';
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  for (const n of a) s += CODE_CHARS[n % CODE_CHARS.length];
  return s;
}
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

// Id desta aba: guardado no sessionStorage, então sobrevive a recarregar a página (o celular costuma
// recarregar a aba quando o jogador sai para o WhatsApp e volta) e a sala reconhece o mesmo jogador.
const ID_KEY = 'xadrez-net-id';
export function tabId() {
  const fresh = () => (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    let v = sessionStorage.getItem(ID_KEY);
    if (!v) { v = fresh(); sessionStorage.setItem(ID_KEY, v); }
    return v;
  } catch { return fresh(); }
}

// Fechamentos em andamento por código: reabrir a mesma sala espera o canal antigo terminar de fechar.
const closing = new Map();

function transportKind() {
  try { return new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'supabase'; } catch { return 'supabase'; }
}

let clientPromise = null;
function supabaseClient() {
  if (clientPromise) return clientPromise;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), ms))]);
  clientPromise = (async () => {
    // No site: o mesmo cliente da conta (/conta/). Fora dele (prévia), a biblioteca do CDN com a chave pública.
    try {
      const m = await withTimeout(import('/conta/client.mjs'), 6000);
      if (m && m.client && m.client.channel) return m.client;
    } catch { /* segue para o CDN */ }
    const lib = await withTimeout(import(SUPABASE.cdn), 12000);
    return lib.createClient(SUPABASE.url, SUPABASE.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  })();
  clientPromise.catch(() => { clientPromise = null; });
  return clientPromise;
}

// Abre a sala `code`. Callbacks: onMessage(payload), onPeers(n, ids dos outros presentes), onStatus('conectado'|'erro'|...)
export async function openRoom(code, { role, onMessage, onPeers, onStatus }) {
  const id = tabId();
  if (closing.has(code)) await closing.get(code);
  const deliver = (payload) => { if (payload && payload.from !== id && (!payload.to || payload.to === id)) onMessage(payload); };
  if (transportKind() === 'local') return openLocal(code, id, { role, deliver, onPeers, onStatus });

  const client = await supabaseClient();
  const ch = client.channel('xadrez-' + code, { config: { broadcast: { self: false, ack: false }, presence: { key: id } } });
  let closed = false;
  ch.on('broadcast', { event: 'm' }, ({ payload }) => { if (!closed) deliver(payload); });
  ch.on('presence', { event: 'sync' }, () => {
    if (closed) return;
    const ids = Object.keys(ch.presenceState()).filter((k) => k !== id);
    onPeers(ids.length, ids);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sem resposta do servidor')), 15000);
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        try { await ch.track({ role, at: Date.now() }); } catch { /* presença é só informativa */ }
        onStatus && onStatus('conectado');
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onStatus && onStatus('erro');
        clearTimeout(timer);
        reject(new Error('não foi possível conectar à sala'));
      } else if (status === 'CLOSED' && !closed) {
        onStatus && onStatus('desconectado');
      }
    });
  });
  return {
    id, code, role,
    send(payload) { if (!closed) ch.send({ type: 'broadcast', event: 'm', payload: { ...payload, from: id } }); },
    close() {
      if (closed) return closing.get(code) || Promise.resolve();
      closed = true;
      const p = (async () => {
        try { await ch.untrack(); } catch { /* ok */ }
        try { await Promise.race([client.removeChannel(ch), new Promise((r) => setTimeout(r, 3000))]); } catch { /* ok */ }
      })().finally(() => { if (closing.get(code) === p) closing.delete(code); });
      closing.set(code, p);
      return p;
    },
  };
}

// Transporte local (mesmo navegador, abas diferentes): BroadcastChannel com presença simulada.
function openLocal(code, id, { role, deliver, onPeers, onStatus }) {
  const bc = new BroadcastChannel('xadrez-' + code);
  const peers = new Map(); // id -> último sinal
  let closed = false;
  const post = (m) => bc.postMessage({ ...m, from: id });
  const beat = () => post({ __p: 'here', role });
  const report = () => onPeers(peers.size, [...peers.keys()]);
  bc.onmessage = (e) => {
    const m = e.data;
    if (closed || !m || m.from === id) return;
    if (m.__p) {
      if (m.__p === 'bye') peers.delete(m.from);
      else { const had = peers.has(m.from); peers.set(m.from, Date.now()); if (!had && m.__p === 'hello') beat(); }
      report();
      return;
    }
    deliver(m);
  };
  post({ __p: 'hello', role });
  const timer = setInterval(() => {
    beat();
    const now = Date.now();
    let changed = false;
    for (const [k, t] of peers) if (now - t > 3500) { peers.delete(k); changed = true; }
    if (changed) report();
  }, 1000);
  const onUnload = () => post({ __p: 'bye' });
  addEventListener('pagehide', onUnload);
  onStatus && onStatus('conectado');
  return Promise.resolve({
    id, code, role,
    send(payload) { if (!closed) post(payload); },
    close() { if (!closed) { post({ __p: 'bye' }); closed = true; clearInterval(timer); removeEventListener('pagehide', onUnload); bc.close(); } return Promise.resolve(); },
  });
}
