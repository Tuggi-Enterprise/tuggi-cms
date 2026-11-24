/**
 * Before a duplicate POI is deleted, the tourists' saves move to the survivor (#958).
 *
 * `drive.saved_items.attraction_id` cascades on delete (migration 20261019120000 of db-tuggiApp):
 * deleting the losers without this call drops every save they had, with no error. The function
 * `core.repoint_saved_items(p_loser_ids, p_survivor_id)` moves them, one row per user, and keeps
 * `notify` if any merged save had it. service_role only.
 *
 * Before that migration is applied the function does not exist, and neither does the table, so
 * there is nothing to lose: the merge goes on. Any other refusal stops the merge BEFORE the delete.
 */

interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

export type RepointResult = { moved: number } | { skipped: 'function_absent' }

export async function repointSavedItemsBeforeDelete(
  db: RpcClient,
  loserIds: string[],
  survivorId: string,
): Promise<RepointResult> {
  if (loserIds.length === 0) return { moved: 0 }
  const { data, error } = await db.rpc('repoint_saved_items', { p_loser_ids: loserIds, p_survivor_id: survivorId })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return { skipped: 'function_absent' }
    throw new Error(`repoint_saved_items refused (${error.code ?? 'no code'}): the losers were NOT deleted`)
  }
  return { moved: Number(data ?? 0) }
}
