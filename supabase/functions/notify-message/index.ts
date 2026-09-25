// Aviso por e-mail de mensagem nova. Chamado por Database Webhook (INSERT em public.messages)
// com o cabeçalho x-webhook-secret = NOTIFY_WEBHOOK_SECRET (verify_jwt = false).
// Envia via Resend só se o destinatário ainda não leu e não foi avisado nos últimos 30 min
// nesta conversa. Sem RESEND_API_KEY/EMAIL_FROM => não faz nada (200).
import { adminClient } from '../_shared/supabase.ts';
import { timingSafeEqual } from '../_shared/mp.ts';

const THROTTLE_MIN = 30;
const PREVIEW_CHARS = 300;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Escapa texto de usuário para o HTML do e-mail
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

// "Maria da Silva" -> "Maria S." (mesma regra de public.short_name)
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Usuário';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

// Tira quebras/controles (vai no assunto do e-mail)
function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const expected = Deno.env.get('NOTIFY_WEBHOOK_SECRET');
  const got = req.headers.get('x-webhook-secret') ?? '';
  if (!expected || !timingSafeEqual(got, expected)) return json(401, { error: 'unauthorized' });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const emailFrom = Deno.env.get('EMAIL_FROM');
  if (!resendKey || !emailFrom) return json(200, { skipped: 'email_not_configured' });

  let payload: Record<string, unknown> | null = null;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'invalid json' });
  }
  if (payload?.type !== 'INSERT' || payload?.table !== 'messages') return json(200, { skipped: 'not_message_insert' });
  const msgId = Number((payload.record as Record<string, unknown> | null)?.id);
  if (!Number.isSafeInteger(msgId) || msgId <= 0) return json(400, { error: 'invalid record' });

  try {
    const admin = adminClient();

    // Relê mensagem e conversa do banco (o payload serve só para achar o id)
    const { data: msg, error: msgErr } = await admin
      .from('messages').select('id, conversation_id, sender_id, body, created_at').eq('id', msgId).maybeSingle();
    if (msgErr) throw msgErr;
    if (!msg) return json(200, { skipped: 'message_not_found' });

    const { data: conv, error: convErr } = await admin
      .from('conversations')
      .select('id, student_id, tutor_id, student_last_read_at, tutor_last_read_at, student_notified_at, tutor_notified_at')
      .eq('id', msg.conversation_id)
      .maybeSingle();
    if (convErr) throw convErr;
    if (!conv) return json(200, { skipped: 'conversation_not_found' });

    // Lado do destinatário
    const side = msg.sender_id === conv.student_id ? 'tutor' : msg.sender_id === conv.tutor_id ? 'student' : null;
    if (!side) return json(200, { skipped: 'unknown_sender' });
    const recipientId: string = side === 'tutor' ? conv.tutor_id : conv.student_id;
    const lastRead = side === 'tutor' ? conv.tutor_last_read_at : conv.student_last_read_at;
    if (lastRead && new Date(lastRead) >= new Date(msg.created_at)) return json(200, { skipped: 'already_read' });

    // Destinatário ativo e com e-mail
    const { data: rp, error: rpErr } = await admin
      .from('profiles').select('banned_at').eq('id', recipientId).maybeSingle();
    if (rpErr) throw rpErr;
    if (!rp || rp.banned_at) return json(200, { skipped: 'recipient_inactive' });
    const { data: au, error: auErr } = await admin.auth.admin.getUserById(recipientId);
    if (auErr) throw auErr;
    const email = au?.user?.email;
    if (!email) return json(200, { skipped: 'no_email' });

    const { data: sp } = await admin.from('profiles').select('full_name').eq('id', msg.sender_id).maybeSingle();
    const fullName = oneLine(String(sp?.full_name ?? '')) || 'Usuário';
    // Professor aparece com nome público; aluno, abreviado
    const senderName = side === 'student' ? fullName : shortName(fullName);

    // Reserva o aviso de forma atômica (throttle de 30 min; evita e-mail duplicado em corrida)
    const col = side === 'tutor' ? 'tutor_notified_at' : 'student_notified_at';
    const previous = side === 'tutor' ? conv.tutor_notified_at : conv.student_notified_at;
    const nowIso = new Date().toISOString();
    const cutoff = new Date(Date.now() - THROTTLE_MIN * 60 * 1000).toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from('conversations')
      .update({ [col]: nowIso })
      .eq('id', conv.id)
      .or(`${col}.is.null,${col}.lt."${cutoff}"`)
      .select('id');
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) return json(200, { skipped: 'throttled' });

    const siteUrl = (Deno.env.get('SITE_URL') ?? 'https://quantaaulas.com').replace(/\/+$/, '');
    const link = `${siteUrl}/professores/mensagens.html?c=${encodeURIComponent(conv.id)}`;
    const text = String(msg.body ?? '');
    const preview = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
    const subject = `Nova mensagem de ${senderName} — Quanta Aulas`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px">
<p>Olá!</p>
<p><strong>${esc(senderName)}</strong> enviou uma mensagem para você no Quanta Aulas:</p>
<div style="margin:0 0 16px;padding:12px 16px;background:#f2f6f3;border-left:4px solid #1f8a5b;white-space:pre-line">${esc(preview)}</div>
<p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#1f8a5b;color:#ffffff;text-decoration:none;border-radius:8px">Responder mensagem</a></p>
<p style="font-size:12px;color:#666666">Por segurança, nunca envie senhas ou dados de cartão por mensagem. Você recebe no máximo um aviso a cada ${THROTTLE_MIN} minutos por conversa.</p>
</div>`;
    const plain = `${senderName} enviou uma mensagem para você no Quanta Aulas:\n\n${preview}\n\nResponder: ${link}\n`;

    let sent = false;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `notify-message-${msg.id}`,
        },
        body: JSON.stringify({ from: emailFrom, to: [email], subject, html, text: plain }),
        signal: AbortSignal.timeout(15000),
      });
      sent = res.ok;
      if (!res.ok) console.error('notify-message: Resend respondeu', res.status, (await res.text()).slice(0, 300));
    } catch (err) {
      console.error('notify-message: falha ao chamar o Resend', err);
    }

    if (!sent) {
      // Devolve a reserva para a próxima mensagem poder avisar
      await admin.from('conversations').update({ [col]: previous ?? null }).eq('id', conv.id).eq(col, nowIso);
      return json(502, { error: 'email_failed' });
    }
    return json(200, { sent: true });
  } catch (err) {
    console.error('notify-message:', err);
    return json(500, { error: 'internal' });
  }
});
