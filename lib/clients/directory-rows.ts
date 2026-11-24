/**
 * ONE ROW PER CLIENT (#991). Pure: `loadClientDirectory` builds the three kinds of row and this
 * decides which of them reach the screen.
 *
 * The directory has three sources: proposals (`partner_form_submissions`, the client through
 * `promoted_client_id`), portal submissions (`partner.place_submissions`) and clients nobody
 * proposed. Until #991 a portal submission became a row even when its client already had one, so
 * the 35 legacy mirrors seeded by #916 put 34 old clients of Cabo Frio on the list twice, the
 * second row reading the mirror's placeholder answers. Both rows also shared `rowKey`, which made
 * React keep rows of an earlier search on screen.
 *
 * The rule, operator decision of 2026-10-22: the client is one record and is managed from its
 * record. So a portal submission folds into the row its client already has, and only stays a row
 * of its own while it is the work (before approval) or when it is the client's only origin.
 */

import type { ClientDirectoryRow } from "@/lib/services/partnership-service";

export interface PortalDirectoryRow {
  row: ClientDirectoryRow;
  /**
   * The submission belongs to a client that predates the portal (`legacy_client_id`, #916). Its
   * client has a record and, usually, a proposal; the submission is only how it reaches `/status`.
   */
  legacy: boolean;
}

/** The earlier of two ISO instants, either of which may be absent. */
function earliest(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a <= b ? a : b;
}

/**
 * The portal's facts on the client's row: when it went live, what was accepted there, and the
 * plan it names when the row has none of its own. The client's state, contract and places stay
 * the row's: they are the record's answer, and the portal submission is one fact inside it.
 */
function fold(target: ClientDirectoryRow, portal: ClientDirectoryRow): void {
  target.liveAt = earliest(target.liveAt, portal.liveAt);
  target.portalAcceptance =
    target.portalAcceptance ?? portal.portalAcceptance ?? null;
  target.planChoice = target.planChoice ?? portal.planChoice;
  // #1000: what the partner saved on `/status` lives on the mirror and is shown on the record.
  target.hasHeldPhoto = target.hasHeldPhoto || portal.hasHeldPhoto;
  target.hasHeldStory = target.hasHeldStory || portal.hasHeldStory;
}

/**
 * The list the screen renders. `proposalRows` and `clientRows` come from the record side
 * (`clientRows` = every client no proposal claims); `portalRows` from the portal.
 *
 * - A portal submission whose client has a proposal row folds into it.
 * - A legacy submission whose client has a row of its own folds into that row.
 * - Any other portal submission with a client claims it: the portal row is that client's row, as
 *   it was since #812, because its state comes from the portal's statuses and its board acts
 *   publish through `attractionId`.
 * - A portal submission without a client yet (before approval) is a row of its own.
 *
 * Never folds into another portal row: two submissions of one client are two places in two
 * workflows, and each keeps its card.
 */
export function assembleDirectoryRows(
  proposalRows: ClientDirectoryRow[],
  clientRows: ClientDirectoryRow[],
  portalRows: PortalDirectoryRow[],
): ClientDirectoryRow[] {
  const proposalOf = new Map<string, ClientDirectoryRow>();
  for (const row of proposalRows) {
    if (row.clientId && !proposalOf.has(row.clientId))
      proposalOf.set(row.clientId, row);
  }
  const clientRowOf = new Map<string, ClientDirectoryRow>();
  for (const row of clientRows) {
    if (row.clientId) clientRowOf.set(row.clientId, row);
  }

  const ownRows: ClientDirectoryRow[] = [];
  const claimed = new Set<string>();
  for (const { row, legacy } of portalRows) {
    const clientId = row.clientId;
    const proposal = clientId ? proposalOf.get(clientId) : undefined;
    if (proposal) {
      fold(proposal, row);
      continue;
    }
    const record = clientId ? clientRowOf.get(clientId) : undefined;
    if (legacy && record) {
      fold(record, row);
      continue;
    }
    if (clientId) claimed.add(clientId);
    ownRows.push(row);
  }

  return proposalRows
    .concat(ownRows)
    .concat(
      clientRows.filter((row) => !(row.clientId && claimed.has(row.clientId))),
    );
}
