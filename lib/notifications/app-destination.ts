/**
 * WHERE A COMPOSED PUSH TAKES THE TOURIST — the closed list of the composer (#860).
 *
 * Spec `design` #860 §5: the field "Destino no app" is REQUIRED, and it is a choice among the
 * routes the app's `DeepLinkService` knows, or an external link. A free-text route is how the
 * 222 inbox rows of 2026-08-23 ended up with no link at all — so the list is closed here.
 *
 * Wire shape, `docs/contracts/notificacoes.md` §2.2: the link travels in `data.url` (the
 * spelling the composer has always emitted; `resolveDeeplink` copies it to the `deeplink`
 * column). App routes go as `tuggi://<route>` — the custom scheme whose hostname the app
 * remaps to the path (`deepLinkPathOf`), same as `tuggi://ranking` from the orchestrator.
 *
 * An installed app that does not route a path yet (`/earn`, `/trips` before the #860 build)
 * renders no button for it — contract §2, "nenhum botão. Nunca botão desabilitado". The push
 * still opens the inbox, so nothing breaks; it only waits for the store build.
 */

/** Order is the order of the select. Paths as the app's `ROUTED_DEEPLINK_PATHS` spells them. */
export const APP_DESTINATIONS = [
  '/map',
  '/guide-start',
  '/earn',
  '/stamps',
  '/ranking',
  '/plans',
  '/trips',
] as const;

export type AppDestination = (typeof APP_DESTINATIONS)[number];

export const EXTERNAL_DESTINATION = 'external' as const;

export type DestinationChoice = AppDestination | typeof EXTERNAL_DESTINATION;

export const DESTINATION_CHOICES: readonly DestinationChoice[] = [
  ...APP_DESTINATIONS,
  EXTERNAL_DESTINATION,
];

/** i18n key segment for a choice: `/guide-start` → `guide_start`. */
export function destinationKey(choice: DestinationChoice): string {
  return choice === EXTERNAL_DESTINATION ? 'external' : choice.slice(1).replace(/-/g, '_');
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

/** The app opens external links over http(s) only (contract §2, botão externo). */
export function isWebUrl(value: string): boolean {
  const url = parseUrl(value);
  return !!url && (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname;
}

/**
 * The app renders `data.image_url` only when it is `https` (spec #860 §3.D). Anything else
 * would be dropped on the device, so the composer refuses it instead of sending it.
 */
export function isHttpsUrl(value: string): boolean {
  const url = parseUrl(value);
  return !!url && url.protocol === 'https:' && !!url.hostname;
}

/**
 * The link that goes in `data.url`, or `null` when the choice is incomplete — no choice, or
 * "external" with an URL that is not http(s). `null` blocks the send: the field is required.
 */
export function destinationLink(choice: DestinationChoice | '', externalUrl: string): string | null {
  if (!choice) return null;
  if (choice === EXTERNAL_DESTINATION) return isWebUrl(externalUrl) ? externalUrl.trim() : null;
  return `tuggi:/${choice}`;
}
