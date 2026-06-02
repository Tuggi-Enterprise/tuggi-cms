// _shared/emailLayout.ts
//
// SSOT do visual dos emails de newsletter (marca Tuggi). Renderiza o conteúdo
// estruturado por idioma dentro de um layout responsivo único. Como o composer
// é por campos (sem HTML livre), todo texto é escapado — o admin nunca quebra o
// layout. A própria Edge Function usa esta função para enviar E para o preview,
// então o painel mostra exatamente o que o usuário recebe.

export interface NewsletterContent {
  subject?: string;
  preheader?: string; // texto de preview na inbox (não aparece no corpo)
  title?: string;
  paragraphs?: string[];
  cta_label?: string;
  cta_url?: string;
  hero_image_url?: string;
}

export interface RenderEmailOptions {
  unsubscribeUrl: string;
  locale?: string;
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

  const hero = content.hero_image_url
    ? `<tr><td style="padding:0 0 24px 0;">
         <img src="${safeUrl(content.hero_image_url)}" alt="" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:12px;" />
       </td></tr>`
    : '';

  const cta =
    content.cta_label && content.cta_url
      ? `<tr><td style="padding:8px 0 8px 0;">
           <a href="${safeUrl(content.cta_url)}" target="_blank"
              style="display:inline-block;background:${COLORS.blue};color:#ffffff;text-decoration:none;
                     font-size:16px;font-weight:700;padding:14px 28px;border-radius:9999px;">
             ${escapeHtml(content.cta_label)}
           </a>
         </td></tr>`
      : '';

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
                ${hero}
                ${title ? `<tr><td style="padding:0 0 16px 0;"><h1 style="margin:0;font-size:24px;line-height:1.3;color:${COLORS.text};font-weight:800;">${title}</h1></td></tr>` : ''}
                <tr><td>${paragraphs}</td></tr>
                ${cta}
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
