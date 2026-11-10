/**
 * The founder's welcome to a new permanent account: BR-COMUNICACAO-019 item 3.r (#1182).
 * Copy, approved by the operator on 2026-11-10: docs/design/copy/boas-vindas-do-fundador-2026-11.md
 *
 * Two pieces, one message. The push says a message is waiting and opens the Correio; the Correio
 * row is the letter itself, in the founder's voice, with paragraphs (`\n`, blank line `\n\n`).
 * Six languages, `de` included (item 11, BR-IDIOMA-001 item 3); any other reads English.
 *
 * Pure strings: no remote import and no `Deno` global, so the tests import it directly.
 */
import type { RankingCopyLang } from './ranking-comm-i18n.ts';

export interface AccountWelcomeCopy {
  push: { title: string; body: string };
  inbox: { title: string; body: string };
}

export const ACCOUNT_WELCOME_COPY: Readonly<Record<RankingCopyLang, AccountWelcomeCopy>> = {
  pt: {
    push: {
      title: 'Boas-vindas ao Tuggi',
      body: 'Leandro Ramos, fundador do Tuggi, deixou uma mensagem para você. Toque para ler.',
    },
    inbox: {
      title: 'Boas-vindas ao Tuggi',
      body:
        'Parabéns, sua conta está criada. A partir de agora você explora o caminho com a gente.\n\n' +
        'Criei o Tuggi para que os lugares por onde você passa contem a própria história, e fico feliz de ter você aqui.\n\n' +
        'Boa viagem,\nLeandro Ramos\nFundador do Tuggi · @leandroramos',
    },
  },
  en: {
    push: {
      title: 'Welcome to Tuggi',
      body: "Leandro Ramos, Tuggi's founder, left you a message. Tap to read it.",
    },
    inbox: {
      title: 'Welcome to Tuggi',
      body:
        'Congratulations, your account is ready. From now on, you explore the road with us.\n\n' +
        "I created Tuggi so the places along your way could tell their own stories, and I'm glad to have you here.\n\n" +
        'Safe travels,\nLeandro Ramos\nFounder of Tuggi · @leandroramos',
    },
  },
  es: {
    push: {
      title: 'Te damos la bienvenida a Tuggi',
      body: 'Leandro Ramos, fundador de Tuggi, te dejó un mensaje. Toca para leerlo.',
    },
    inbox: {
      title: 'Te damos la bienvenida a Tuggi',
      body:
        'Felicidades, tu cuenta está lista. Desde ahora exploras el camino con nosotros.\n\n' +
        'Creé Tuggi para que los lugares por donde pasas cuenten su propia historia, y me alegra tenerte aquí.\n\n' +
        'Buen viaje,\nLeandro Ramos\nFundador de Tuggi · @leandroramos',
    },
  },
  fr: {
    push: {
      title: 'Bienvenue sur Tuggi',
      body: "Leandro Ramos, fondateur de Tuggi, t'a laissé un message. Touche pour le lire.",
    },
    inbox: {
      title: 'Bienvenue sur Tuggi',
      body:
        'Félicitations, ton compte est prêt. Désormais, tu explores la route avec nous.\n\n' +
        "J'ai créé Tuggi pour que les lieux sur ton chemin racontent leur propre histoire, et je suis content de t'avoir parmi nous.\n\n" +
        'Bonne route,\nLeandro Ramos\nFondateur de Tuggi · @leandroramos',
    },
  },
  it: {
    push: {
      title: 'Ti diamo il benvenuto su Tuggi',
      body: 'Leandro Ramos, fondatore di Tuggi, ti ha lasciato un messaggio. Tocca per leggerlo.',
    },
    inbox: {
      title: 'Ti diamo il benvenuto su Tuggi',
      body:
        'Complimenti, il tuo account è pronto. Da oggi esplori la strada con noi.\n\n' +
        'Ho creato Tuggi perché i luoghi lungo il tuo cammino possano raccontare la loro storia, e sono felice di averti qui.\n\n' +
        'Buon viaggio,\nLeandro Ramos\nFondatore di Tuggi · @leandroramos',
    },
  },
  de: {
    push: {
      title: 'Willkommen bei Tuggi',
      body: 'Leandro Ramos, Gründer von Tuggi, hat dir eine Nachricht hinterlassen. Tippe, um sie zu lesen.',
    },
    inbox: {
      title: 'Willkommen bei Tuggi',
      body:
        'Glückwunsch, dein Konto ist bereit. Ab jetzt entdeckst du die Strecke mit uns.\n\n' +
        'Ich habe Tuggi gegründet, damit die Orte an deinem Weg ihre eigene Geschichte erzählen, und ich freue mich, dass du dabei bist.\n\n' +
        'Gute Fahrt,\nLeandro Ramos\nGründer von Tuggi · @leandroramos',
    },
  },
};
