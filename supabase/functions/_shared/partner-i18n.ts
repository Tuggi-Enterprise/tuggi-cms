// Shared i18n for partner-flow notifications (email + push), used by both the
// send-transactional and firebase-push-notification Edge Functions so the copy
// stays in ONE place across all project languages.
//
// Events: 'received' (registration acknowledged), 'approved', 'rejected'.
// %NAME% in the first email paragraph is replaced with the partner name (or '').

export type PartnerEvent = 'received' | 'approved' | 'rejected';
export type Lang = 'pt' | 'en' | 'es' | 'fr' | 'it';

export interface PartnerStrings {
  push: { title: string; body: string };
  email: {
    subject: string;
    heading: string;
    paragraphs: string[]; // paragraphs[0] may contain %NAME%
    cta?: string; // approved: button label
    reasonLabel?: string; // rejected: label before the reason
  };
}

const PT: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Cadastro recebido ✅',
      body: 'Recebemos seu cadastro de parceiro. Está em análise — avisaremos em breve.',
    },
    email: {
      subject: 'Recebemos seu cadastro de parceiro Tuggi ✅',
      heading: 'Cadastro recebido!',
      paragraphs: [
        'Olá%NAME%, recebemos seu cadastro de parceiro Tuggi e ele já está em análise.',
        'Você será avisado(a) por email e por notificação no app assim que tivermos uma resposta.',
        'Obrigado por querer fazer parte da rede de parceiros Tuggi!',
      ],
    },
  },
  approved: {
    push: {
      title: 'Parceria aprovada! 🎉',
      body: 'Seu cadastro foi aprovado e você ganhou o Tuggi Pro. Veja seu QR Code no app.',
    },
    email: {
      subject: 'Sua parceria com a Tuggi foi aprovada! 🎉',
      heading: 'Parceria aprovada!',
      paragraphs: [
        'Olá%NAME%, sua parceria com a Tuggi foi aprovada e você recebeu o Tuggi Pro! 🎉',
        'Abra o app Tuggi para ver seu QR Code e aproveitar todos os benefícios Pro.',
        'Bem-vindo(a) à rede de parceiros Tuggi.',
      ],
      cta: 'Abrir o Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'Sobre seu cadastro Tuggi',
      body: 'Houve uma atualização no seu cadastro de parceiro.',
    },
    email: {
      subject: 'Sobre seu cadastro de parceiro Tuggi',
      heading: 'Cadastro não aprovado',
      paragraphs: [
        'Olá%NAME%, infelizmente seu cadastro de parceiro não foi aprovado desta vez.',
        'Se tiver dúvidas, responda este email.',
      ],
      reasonLabel: 'Motivo:',
    },
  },
};

const EN: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Registration received ✅',
      body: 'We got your partner registration. It’s under review — we’ll be in touch soon.',
    },
    email: {
      subject: 'We received your Tuggi partner registration ✅',
      heading: 'Registration received!',
      paragraphs: [
        'Hi%NAME%, we received your Tuggi partner registration and it’s now under review.',
        'We’ll notify you by email and with an in-app notification as soon as we have an answer.',
        'Thank you for wanting to join the Tuggi partner network!',
      ],
    },
  },
  approved: {
    push: {
      title: 'Partnership approved! 🎉',
      body: 'Your registration was approved and you got Tuggi Pro. See your QR code in the app.',
    },
    email: {
      subject: 'Your Tuggi partnership was approved! 🎉',
      heading: 'Partnership approved!',
      paragraphs: [
        'Hi%NAME%, your Tuggi partnership was approved and you’ve received Tuggi Pro! 🎉',
        'Open the Tuggi app to see your QR code and enjoy all your Pro benefits.',
        'Welcome to the Tuggi partner network.',
      ],
      cta: 'Open Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'About your Tuggi registration',
      body: 'There’s an update on your partner registration.',
    },
    email: {
      subject: 'About your Tuggi partner registration',
      heading: 'Registration not approved',
      paragraphs: [
        'Hi%NAME%, unfortunately your partner registration was not approved this time.',
        'If you have any questions, just reply to this email.',
      ],
      reasonLabel: 'Reason:',
    },
  },
};

const ES: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Registro recibido ✅',
      body: 'Recibimos tu registro de socio. Está en revisión — te avisaremos pronto.',
    },
    email: {
      subject: 'Recibimos tu registro de socio Tuggi ✅',
      heading: '¡Registro recibido!',
      paragraphs: [
        'Hola%NAME%, recibimos tu registro de socio Tuggi y ya está en revisión.',
        'Te avisaremos por correo y con una notificación en la app en cuanto tengamos una respuesta.',
        '¡Gracias por querer formar parte de la red de socios Tuggi!',
      ],
    },
  },
  approved: {
    push: {
      title: '¡Asociación aprobada! 🎉',
      body: 'Tu registro fue aprobado y obtuviste Tuggi Pro. Mira tu código QR en la app.',
    },
    email: {
      subject: '¡Tu asociación con Tuggi fue aprobada! 🎉',
      heading: '¡Asociación aprobada!',
      paragraphs: [
        'Hola%NAME%, ¡tu asociación con Tuggi fue aprobada y recibiste Tuggi Pro! 🎉',
        'Abre la app Tuggi para ver tu código QR y disfrutar todos los beneficios Pro.',
        'Bienvenido(a) a la red de socios Tuggi.',
      ],
      cta: 'Abrir Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'Sobre tu registro Tuggi',
      body: 'Hay una actualización en tu registro de socio.',
    },
    email: {
      subject: 'Sobre tu registro de socio Tuggi',
      heading: 'Registro no aprobado',
      paragraphs: [
        'Hola%NAME%, lamentablemente tu registro de socio no fue aprobado esta vez.',
        'Si tienes dudas, responde a este correo.',
      ],
      reasonLabel: 'Motivo:',
    },
  },
};

const FR: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Inscription reçue ✅',
      body: 'Nous avons reçu votre inscription partenaire. En cours d’examen — à très vite.',
    },
    email: {
      subject: 'Nous avons reçu votre inscription partenaire Tuggi ✅',
      heading: 'Inscription reçue !',
      paragraphs: [
        'Bonjour%NAME%, nous avons reçu votre inscription partenaire Tuggi et elle est en cours d’examen.',
        'Vous serez prévenu(e) par e-mail et par une notification dans l’app dès que nous aurons une réponse.',
        'Merci de vouloir rejoindre le réseau de partenaires Tuggi !',
      ],
    },
  },
  approved: {
    push: {
      title: 'Partenariat approuvé ! 🎉',
      body: 'Votre inscription a été approuvée et vous avez reçu Tuggi Pro. Voir votre QR code dans l’app.',
    },
    email: {
      subject: 'Votre partenariat avec Tuggi a été approuvé ! 🎉',
      heading: 'Partenariat approuvé !',
      paragraphs: [
        'Bonjour%NAME%, votre partenariat avec Tuggi a été approuvé et vous avez reçu Tuggi Pro ! 🎉',
        'Ouvrez l’app Tuggi pour voir votre QR code et profiter de tous les avantages Pro.',
        'Bienvenue dans le réseau de partenaires Tuggi.',
      ],
      cta: 'Ouvrir Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'À propos de votre inscription Tuggi',
      body: 'Il y a une mise à jour sur votre inscription partenaire.',
    },
    email: {
      subject: 'À propos de votre inscription partenaire Tuggi',
      heading: 'Inscription non approuvée',
      paragraphs: [
        'Bonjour%NAME%, malheureusement votre inscription partenaire n’a pas été approuvée cette fois.',
        'Pour toute question, répondez simplement à cet e-mail.',
      ],
      reasonLabel: 'Motif :',
    },
  },
};

const IT: Record<PartnerEvent, PartnerStrings> = {
  received: {
    push: {
      title: 'Registrazione ricevuta ✅',
      body: 'Abbiamo ricevuto la tua registrazione partner. È in revisione — a presto.',
    },
    email: {
      subject: 'Abbiamo ricevuto la tua registrazione partner Tuggi ✅',
      heading: 'Registrazione ricevuta!',
      paragraphs: [
        'Ciao%NAME%, abbiamo ricevuto la tua registrazione partner Tuggi ed è già in revisione.',
        'Ti avviseremo via email e con una notifica nell’app non appena avremo una risposta.',
        'Grazie per voler far parte della rete di partner Tuggi!',
      ],
    },
  },
  approved: {
    push: {
      title: 'Partnership approvata! 🎉',
      body: 'La tua registrazione è stata approvata e hai ricevuto Tuggi Pro. Vedi il QR code nell’app.',
    },
    email: {
      subject: 'La tua partnership con Tuggi è stata approvata! 🎉',
      heading: 'Partnership approvata!',
      paragraphs: [
        'Ciao%NAME%, la tua partnership con Tuggi è stata approvata e hai ricevuto Tuggi Pro! 🎉',
        'Apri l’app Tuggi per vedere il tuo QR code e goderti tutti i vantaggi Pro.',
        'Benvenuto(a) nella rete di partner Tuggi.',
      ],
      cta: 'Apri Tuggi',
    },
  },
  rejected: {
    push: {
      title: 'Sulla tua registrazione Tuggi',
      body: 'C’è un aggiornamento sulla tua registrazione partner.',
    },
    email: {
      subject: 'Sulla tua registrazione partner Tuggi',
      heading: 'Registrazione non approvata',
      paragraphs: [
        'Ciao%NAME%, purtroppo la tua registrazione partner non è stata approvata questa volta.',
        'Per qualsiasi domanda, rispondi a questa email.',
      ],
      reasonLabel: 'Motivo:',
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
