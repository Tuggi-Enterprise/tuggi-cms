/**
 * The states a partner contract can be in — the single declaration of a union that was written
 * out by hand in five places.
 *
 * IT LIVES HERE AND NOT IN `partner-contract-service` for one reason: the modules that decide
 * the pipeline (`lib/partnerships/pipeline`) and the ones that filter the directory
 * (`lib/clients/directory-filter`) are pure and are proven without a database. Importing the
 * service to borrow a type drags a `service_role` client into their import graph, and
 * `import type` erasing at build time is not something a reader of the file can see.
 *
 * `ContractStatus` is what `partner.partner_contracts.status` holds. `ContractState` adds the
 * one value the COLUMN cannot carry — `none`, for a client with no live contract at all — and
 * is what the directory row and the pipeline decide with. The distinction is not cosmetic: a
 * client with no contract and a client whose contract was terminated are different rows with
 * different next steps.
 */

/** `partner.partner_contracts.status`, exactly. */
export type ContractStatus = 'draft' | 'sent' | 'signed' | 'superseded' | 'terminated'

export const CONTRACT_STATUSES: ContractStatus[] = [
  'draft',
  'sent',
  'signed',
  'superseded',
  'terminated',
]

/** The live contract's status as a LIST reads it, where having none is an answer. */
export type ContractState = ContractStatus | 'none'

export const CONTRACT_STATES: ContractState[] = (['none'] as ContractState[]).concat(
  CONTRACT_STATUSES
)

/**
 * Whether the partnership has an instrument in force. One reading, so the directory, the
 * pipeline and the board cannot disagree about what "signed" means.
 */
export function isSigned(state: ContractState): boolean {
  return state === 'signed'
}
