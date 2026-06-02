// _shared/emailLayout.ts
//
// SSOT do visual dos emails de newsletter (marca Tuggi). Renderiza o conteúdo
// estruturado por idioma dentro de um layout responsivo único. Como o composer
// é por campos (sem HTML livre), todo texto é escapado — o admin nunca quebra o
// layout. A própria Edge Function usa esta função para enviar E para o preview,
// então o painel mostra exatamente o que o usuário recebe.

export type EmailBlock =
  | { type: 'heading'; text?: string }
  | { type: 'text'; text?: string }
  | { type: 'image'; url?: string; alt?: string; link?: string }
  | { type: 'button'; label?: string; url?: string; variant?: 'primary' | 'accent' }
  | { type: 'divider' };

export interface NewsletterContent {
  subject?: string;
  preheader?: string; // texto de preview na inbox (não aparece no corpo)
  // Modelo novo (composer por blocos). Se presente, substitui os campos legados.
  blocks?: EmailBlock[];
  // Campos legados (compat com campanhas antigas / fallback):
  title?: string;
  paragraphs?: string[];
  cta_label?: string;
  cta_url?: string;
  hero_image_url?: string;
  hero_alt?: string; // texto alternativo (acessibilidade + imagens bloqueadas)
}

export interface RenderEmailOptions {
  unsubscribeUrl: string;
  locale?: string;
  utmCampaign?: string; // adiciona utm_* aos links (atribuição de conversão)
}

// Cores da marca (ver tailwind.config tuggi.*)
const COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  background: '#F7F9FA',
  text: '#1A1A1A',
  muted: '#6B7280',
  border: '#E5E7EB',
};

// Logo público da Tuggi (versão branca, para o header azul). Asset servido pelo site.
const TUGGI_LOGO_URL = 'https://www.tuggi.app/images/logo_tuggi_full_white.png';

// Rótulos do rodapé por idioma (i18n do email é independente do i18n do painel).
const FOOTER_LABELS: Record<string, { unsubscribe: string; rights: string }> = {
  pt: { unsubscribe: 'Cancelar inscrição', rights: 'Tuggi · Todos os direitos reservados' },
  en: { unsubscribe: 'Unsubscribe', rights: 'Tuggi · All rights reserved' },
  es: { unsubscribe: 'Cancelar suscripción', rights: 'Tuggi · Todos los derechos reservados' },
};

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Permite somente http/https/mailto em hrefs (CTA / unsubscribe).
function safeUrl(url: string | undefined): string {
  if (!url) return '#';
  const trimmed = String(url).trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return escapeHtml(trimmed);
  return '#';
}

// Adiciona utm_* a um link http(s) para atribuição de conversão. Mantém params existentes.
function appendUtm(url: string | undefined, campaign?: string): string | undefined {
  if (!url || !campaign) return url;
  try {
    const u = new URL(url.trim());
    if (!/^https?:$/.test(u.protocol)) return url;
    if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', 'newsletter');
    if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'email');
    if (!u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  } catch {
    return url;
  }
}

// Botão "bulletproof": VML para Outlook + <a> para os demais clientes (melhora CTR).
function bulletproofButton(href: string, label: string, color: string = COLORS.blue): string {
  const safe = escapeHtml(label);
  return `<!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="50%" stroke="f" fillcolor="${color}">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">${safe}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${href}" target="_blank" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 28px;border-radius:9999px;">${safe}</a>
    <!--<![endif]-->`;
}

// Markdown leve inline: **negrito** e [texto](url). Escapa o texto puro, converte
// newline em <br>, e aplica UTM aos links. Seguro (sem HTML livre do autor).
function renderInline(raw: string | undefined, utmCampaign?: string): string {
  const text = raw || '';
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  const esc = (s: string) => escapeHtml(s).replace(/\r?\n/g, '<br/>');
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = safeUrl(appendUtm(m[2], utmCampaign));
      out += `<a href="${href}" target="_blank" style="color:${COLORS.blue};text-decoration:underline;">${escapeHtml(m[1])}</a>`;
    } else {
      out += `<strong>${escapeHtml(m[3])}</strong>`;
    }
    last = re.lastIndex;
  }
  out += esc(text.slice(last));
  return out;
}

function renderBlocks(blocks: EmailBlock[], opts: RenderEmailOptions): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return `<tr><td style="padding:0 0 16px 0;"><h2 style="margin:0;font-size:22px;line-height:1.3;font-weight:800;color:${COLORS.text};">${renderInline(b.text, opts.utmCampaign)}</h2></td></tr>`;
        case 'text':
          return `<tr><td style="padding:0 0 16px 0;"><p style="margin:0;font-size:16px;line-height:1.6;color:${COLORS.text};">${renderInline(b.text, opts.utmCampaign)}</p></td></tr>`;
        case 'image': {
          if (!b.url) return '';
          const img = `<img src="${safeUrl(b.url)}" alt="${escapeHtml(b.alt || '')}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:12px;border:0;" />`;
          const wrapped = b.link
            ? `<a href="${safeUrl(appendUtm(b.link, opts.utmCampaign))}" target="_blank">${img}</a>`
            : img;
          return `<tr><td style="padding:0 0 20px 0;background:#eef2f4;border-radius:12px;">${wrapped}</td></tr>`;
        }
        case 'button': {
          if (!b.label || !b.url) return '';
          const color = b.variant === 'accent' ? COLORS.orange : COLORS.blue;
          return `<tr><td style="padding:8px 0 20px 0;">${bulletproofButton(safeUrl(appendUtm(b.url, opts.utmCampaign)), b.label, color)}</td></tr>`;
        }
        case 'divider':
          return `<tr><td style="padding:8px 0 20px 0;"><hr style="border:none;border-top:1px solid ${COLORS.border};margin:0;" /></td></tr>`;
        default:
          return '';
      }
    })
    .join('');
}

// Markdown -> texto puro (para a versão multipart text/plain).
function inlineToText(raw: string | undefined): string {
  return (raw || '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)') // [t](u) -> t (u)
    .replace(/\*\*([^*]+)\*\*/g, '$1'); // **x** -> x
}

/**
 * Versão texto-plano do email (multipart). Melhora deliverability/inbox placement.
 * Recebe o conteúdo JÁ personalizado.
 */
export function renderText(content: NewsletterContent, opts: RenderEmailOptions): string {
  const lines: string[] = [];
  const useBlocks = Array.isArray(content.blocks) && content.blocks.length > 0;

  if (useBlocks) {
    for (const b of content.blocks as EmailBlock[]) {
      if (b.type === 'heading') lines.push(inlineToText(b.text), '');
      else if (b.type === 'text') lines.push(inlineToText(b.text), '');
      else if (b.type === 'button' && b.label && b.url) lines.push(`${b.label}: ${appendUtm(b.url, opts.utmCampaign)}`, '');
      else if (b.type === 'divider') lines.push('---', '');
    }
  } else {
    if (content.title) lines.push(content.title, '');
    for (const p of content.paragraphs || []) lines.push(inlineToText(p), '');
    if (content.cta_label && content.cta_url) lines.push(`${content.cta_label}: ${appendUtm(content.cta_url, opts.utmCampaign)}`, '');
  }

  lines.push('—', `Tuggi · cancelar inscrição: ${opts.unsubscribeUrl}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function renderEmail(content: NewsletterContent, opts: RenderEmailOptions): string {
  const locale = (opts.locale || 'pt').slice(0, 2).toLowerCase();
  const footer = FOOTER_LABELS[locale] || FOOTER_LABELS.pt;

  const title = content.title ? escapeHtml(content.title) : '';
  // Preserva quebras de linha simples (newline -> <br>) dentro de cada parágrafo.
  const paragraphs = (content.paragraphs || [])
    .filter((p) => p && p.trim().length > 0)
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:${COLORS.text};">${escapeHtml(
          p
        ).replace(/\r?\n/g, '<br/>')}</p>`
    )
    .join('');

  // Preheader: texto de preview na inbox, oculto no corpo (truque padrão de email).
  const preheader = content.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(
        content.preheader
      )}</div>`
    : '';

  const heroAlt = escapeHtml(content.hero_alt || content.title || 'Tuggi');
  const hero = content.hero_image_url
    ? `<tr><td style="padding:0 0 24px 0;background:#eef2f4;border-radius:12px;">
         <img src="${safeUrl(content.hero_image_url)}" alt="${heroAlt}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:12px;" />
       </td></tr>`
    : '';

  const ctaHref = safeUrl(appendUtm(content.cta_url, opts.utmCampaign));
  const cta =
    content.cta_label && content.cta_url
      ? `<tr><td style="padding:8px 0 8px 0;">${bulletproofButton(ctaHref, content.cta_label)}</td></tr>`
      : '';

  // Modelo novo (blocos) tem prioridade; senão, render legado (hero/título/parágrafos/cta).
  const useBlocks = Array.isArray(content.blocks) && content.blocks.length > 0;
  const bodyRows = useBlocks
    ? renderBlocks(content.blocks as EmailBlock[], opts)
    : `${hero}
       ${title ? `<tr><td style="padding:0 0 16px 0;"><h1 style="margin:0;font-size:24px;line-height:1.3;color:${COLORS.text};font-weight:800;">${title}</h1></td></tr>` : ''}
       <tr><td>${paragraphs}</td></tr>
       ${cta}`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>${escapeHtml(content.subject || 'Tuggi')}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.background};">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.background};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${COLORS.border};">
          <!-- Header -->
          <tr>
            <td style="background:${COLORS.blue};padding:20px 24px;" align="center">
              <img src="${TUGGI_LOGO_URL}" alt="Tuggi" height="32" style="display:block;height:32px;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 24px 8px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${bodyRows}
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px;border-top:1px solid ${COLORS.border};">
              <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:${COLORS.muted};text-align:center;">
                ${escapeHtml(footer.rights)}
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:${COLORS.muted};text-align:center;">
                <a href="${safeUrl(opts.unsubscribeUrl)}" target="_blank" style="color:${COLORS.muted};text-decoration:underline;">
                  ${escapeHtml(footer.unsubscribe)}
                </a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
