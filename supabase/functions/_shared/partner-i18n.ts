// Shared i18n for partner-flow notifications (email + push), used by both the
// send-transactional and firebase-push-notification Edge Functions so the copy
// stays in ONE place across all project languages.
//
// Audience: the partner without a place (creator, influencer, driver) who asked
// in the app with CPF or CNPJ (BR-B2B-066, BR-USUARIO-052 item 4). Push and
// email both lead to the status screen (`tuggi://partner-status`).
//
// Events (#1181):
//   'received' fires at the acceptance of the agreement, when the request reaches
//              the team (BR-B2B-066 item 5.c). The flow calls it a request, never
//              a registration.
//   'approved' says nothing about Tuggi Pro: the approval grants no plan
//              (BR-B2B-066 item 2). Claims stay inside the BR-B2B-066 ceiling:
//              QR and @ attribute from the approval, commission at the agreed
//              percentage on later purchases, no fixed value, no payment date.
//   'rejected' the email renders the curator's reason (payload key `reason`)
//              after the paragraphs, behind `reasonLabel`. The push has no
//              variable, so it points to the app, where the reason is shown.
// %NAME% in the first email paragraph is replaced with ' ' + partner name (or '').
// fr uses "tu", like the app's partner_request.* screen the push opens.

export type PartnerEvent = 'received' | 'approved' | 'rejected';
export type Lang = 'pt' | 'en' | 'es' | 'fr' | 'it';

export interface PartnerStrings {
  push: { title: string; body: string };
  email: {
    subject: string;
    heading: string;
    paragraphs: string[]; // paragraphs[0] may contain %NAME%
    cta: string; // button label, to the app (every event, #1181)
    reasonLabel?: string; // rejected: label before the reason
  };
}

const PT: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Pedido recebido',
      body: 'O seu pedido de parceria foi para a equipe. Avisamos quando houver resposta.',
    },
    email: {
      subject: 'Recebemos o seu pedido de parceria',
      heading: 'Pedido recebido',
      paragraphs: [
        'Olá%NAME%, recebemos o seu pedido de parceria com o aceite do termo, e ele foi para a análise da equipe.',
        'A resposta chega por e-mail e aparece no app, no mesmo lugar onde você fez o pedido.',
      ],
      cta: 'Abrir o Tuggi',
    },
  },
  approved: {
    push: {
      title: 'Parceria aprovada',
      body: 'A partir de agora, as compras de quem chega ao Tuggi pela primeira vez pelo seu QR ou @ rendem comissão para você.',
    },
    email: {
      subject: 'Sua parceria com o Tuggi foi aprovada',
      heading: 'Parceria aprovada',
      paragraphs: [
        'Olá%NAME%, o seu pedido foi aprovado e a parceria já está valendo.',
        'A partir de agora, quem chega ao Tuggi pela primeira vez pelo seu QR ou pelo seu @ fica ligado a você, e as compras dessas pessoas rendem comissão no percentual combinado com a equipe.',
        'O seu QR e o seu @ estão no app, prontos para divulgar.',
      ],
      cta: 'Abrir o Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'Pedido não aprovado',
      body: 'Veja no app o motivo e envie de novo quando quiser.',
    },
    email: {
      subject: 'Seu pedido de parceria não foi aprovado',
      heading: 'Pedido não aprovado',
      paragraphs: [
        'Olá%NAME%, a equipe analisou o seu pedido de parceria e ele não foi aprovado desta vez.',
        'Você pode corrigir e enviar de novo pelo app quando quiser.',
      ],
      reasonLabel: 'Motivo:',
      cta: 'Corrigir no app',
    },
  },
};

const EN: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Request received',
      body: 'Your partnership request is with our team. We’ll let you know when there’s an answer.',
    },
    email: {
      subject: 'We received your partnership request',
      heading: 'Request received',
      paragraphs: [
        'Hi%NAME%, we received your partnership request and your acceptance of the agreement, and it’s now with our team for review.',
        'You’ll get the answer by email, and it will also show up in the app, in the same place you sent the request.',
      ],
      cta: 'Open Tuggi',
    },
  },
  approved: {
    push: {
      title: 'Partnership approved',
      body: 'From now on, purchases by people who come to Tuggi for the first time through your QR code or @ earn you commission.',
    },
    email: {
      subject: 'Your Tuggi partnership is approved',
      heading: 'Partnership approved',
      paragraphs: [
        'Hi%NAME%, your request was approved and the partnership is now active.',
        'From now on, people who come to Tuggi for the first time through your QR code or your @ are tied to you, and their purchases earn you commission at the percentage agreed with our team.',
        'Your QR code and your @ are in the app, ready to share.',
      ],
      cta: 'Open Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'Request not approved',
      body: 'See the reason in the app and send it again whenever you like.',
    },
    email: {
      subject: 'Your partnership request was not approved',
      heading: 'Request not approved',
      paragraphs: [
        'Hi%NAME%, our team reviewed your partnership request and it was not approved this time.',
        'You can fix it and send it again from the app whenever you like.',
      ],
      reasonLabel: 'Reason:',
      cta: 'Fix it in the app',
    },
  },
};

const ES: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Solicitud recibida',
      body: 'Tu solicitud de alianza ya está con el equipo. Te avisamos cuando haya respuesta.',
    },
    email: {
      subject: 'Recibimos tu solicitud de alianza',
      heading: 'Solicitud recibida',
      paragraphs: [
        'Hola%NAME%, recibimos tu solicitud de alianza con la aceptación del acuerdo, y ya pasó a revisión del equipo.',
        'La respuesta llega por correo y aparece en la app, en el mismo lugar donde hiciste la solicitud.',
      ],
      cta: 'Abrir Tuggi',
    },
  },
  approved: {
    push: {
      title: 'Alianza aprobada',
      body: 'Desde ahora, las compras de quien llega a Tuggi por primera vez por tu QR o tu @ te dan comisión.',
    },
    email: {
      subject: 'Tu alianza con Tuggi está aprobada',
      heading: 'Alianza aprobada',
      paragraphs: [
        'Hola%NAME%, tu solicitud fue aprobada y la alianza ya está vigente.',
        'Desde ahora, quien llega a Tuggi por primera vez por tu QR o tu @ queda vinculado a ti, y sus compras te dan comisión según el porcentaje acordado con el equipo.',
        'Tu QR y tu @ están en la app, listos para compartir.',
      ],
      cta: 'Abrir Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'Solicitud no aprobada',
      body: 'Mira el motivo en la app y envíala de nuevo cuando quieras.',
    },
    email: {
      subject: 'Tu solicitud de alianza no fue aprobada',
      heading: 'Solicitud no aprobada',
      paragraphs: [
        'Hola%NAME%, el equipo revisó tu solicitud de alianza y esta vez no fue aprobada.',
        'Puedes corregirla y enviarla de nuevo desde la app cuando quieras.',
      ],
      reasonLabel: 'Motivo:',
      cta: 'Corregir en la app',
    },
  },
};

const FR: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Demande reçue',
      body: 'Ta demande de partenariat a été transmise à l’équipe. Nous te prévenons dès qu’il y a une réponse.',
    },
    email: {
      subject: 'Nous avons reçu ta demande de partenariat',
      heading: 'Demande reçue',
      paragraphs: [
        'Bonjour%NAME%, nous avons reçu ta demande de partenariat et ton acceptation du contrat, et l’équipe va maintenant l’examiner.',
        'La réponse arrive par e-mail et s’affiche dans l’app, à l’endroit où tu as fait ta demande.',
      ],
      cta: 'Ouvrir Tuggi',
    },
  },
  approved: {
    push: {
      title: 'Partenariat validé',
      body: 'Désormais, les achats de ceux qui arrivent sur Tuggi pour la première fois par ton QR ou ton @ te rapportent une commission.',
    },
    email: {
      subject: 'Ton partenariat avec Tuggi est validé',
      heading: 'Partenariat validé',
      paragraphs: [
        'Bonjour%NAME%, ta demande a été validée et le partenariat est actif dès maintenant.',
        'Désormais, ceux qui arrivent sur Tuggi pour la première fois par ton QR ou ton @ te sont rattachés, et leurs achats te rapportent une commission au pourcentage convenu avec l’équipe.',
        'Ton QR et ton @ sont dans l’app, prêts à être partagés.',
      ],
      cta: 'Ouvrir Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'Demande non validée',
      body: 'Consulte le motif dans l’app et renvoie ta demande quand tu veux.',
    },
    email: {
      subject: 'Ta demande de partenariat n’a pas été validée',
      heading: 'Demande non validée',
      paragraphs: [
        'Bonjour%NAME%, l’équipe a examiné ta demande de partenariat et elle n’a pas été validée cette fois.',
        'Tu peux la corriger et la renvoyer depuis l’app quand tu veux.',
      ],
      reasonLabel: 'Motif\u00A0:',
      cta: 'Corriger dans l’app',
    },
  },
};

const IT: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Richiesta ricevuta',
      body: 'La tua richiesta di partnership è passata al team. Ti avvisiamo quando c’è una risposta.',
    },
    email: {
      subject: 'Abbiamo ricevuto la tua richiesta di partnership',
      heading: 'Richiesta ricevuta',
      paragraphs: [
        'Ciao%NAME%, abbiamo ricevuto la tua richiesta di partnership con l’accettazione dell’accordo, e ora passa all’esame del team.',
        'La risposta arriva via email e compare nell’app, nello stesso punto in cui hai fatto la richiesta.',
      ],
      cta: 'Apri Tuggi',
    },
  },
  approved: {
    push: {
      title: 'Partnership approvata',
      body: 'Da ora, gli acquisti di chi arriva su Tuggi per la prima volta dal tuo QR o dal tuo @ ti fanno guadagnare una commissione.',
    },
    email: {
      subject: 'La tua partnership con Tuggi è approvata',
      heading: 'Partnership approvata',
      paragraphs: [
        'Ciao%NAME%, la tua richiesta è stata approvata e la partnership è già attiva.',
        'Da ora, chi arriva su Tuggi per la prima volta dal tuo QR o dal tuo @ resta collegato a te, e i suoi acquisti ti fanno guadagnare una commissione alla percentuale concordata con il team.',
        'Il tuo QR e il tuo @ sono nell’app, pronti da condividere.',
      ],
      cta: 'Apri Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'Richiesta non approvata',
      body: 'Guarda il motivo nell’app e inviala di nuovo quando vuoi.',
    },
    email: {
      subject: 'La tua richiesta di partnership non è stata approvata',
      heading: 'Richiesta non approvata',
      paragraphs: [
        'Ciao%NAME%, il team ha esaminato la tua richiesta di partnership e questa volta non è stata approvata.',
        'Puoi correggerla e inviarla di nuovo dall’app quando vuoi.',
      ],
      reasonLabel: 'Motivo:',
      cta: 'Correggi nell’app',
    },
  },
};

const TABLE: Record<Lang, Record<PartnerEvent, PartnerStrings>> = {
  pt: PT,
  en: EN,
  es: ES,
  fr: FR,
  it: IT,
};

// Normalize anything ('pt-BR', 'pt_br', 'PT', 'en-US', null) to a supported Lang.
// Falls back to 'pt' (project default).
export function resolveLang(input?: string | null): Lang {
  const base = String(input ?? '')
    .toLowerCase()
    .replace('_', '-')
    .split('-')[0];
  if (base === 'en' || base === 'es' || base === 'fr' || base === 'it') return base;
  return 'pt';
}

export function partnerStrings(event: PartnerEvent, lang?: string | null): PartnerStrings {
  return TABLE[resolveLang(lang)][event];
}
