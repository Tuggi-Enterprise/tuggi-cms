/**
 * Utility functions for batch processing jobs
 */

/**
 * Creates a new batch job in the database
 * @param supabase - Supabase client
 * @param jobType - Type of job (e.g., 'verify', 'improve_descriptions')
 * @param params - Job parameters
 * @returns Object with jobId
 */
export async function createBatchJob(supabase: any, jobType: string, params: any) {
  const { data, error } = await supabase
    .schema('core')
    .rpc('create_batch_job', {
      p_job_type: jobType,
      p_params: params
    });

  if (error) {
    throw new Error(`Failed to create batch job: ${error.message}`);
  }

  return { jobId: data };
}

/**
 * Updates the progress of a batch job
 * @param supabase - Supabase client
 * @param jobId - ID of the job to update
 * @param progress - Progress data to update
 */
export async function updateBatchProgress(supabase: any, jobId: string, progress: any) {
  const { error } = await supabase
    .schema('core')
    .rpc('update_batch_progress', {
      p_job_id: jobId,
      p_status: progress.status,
      p_progress_message: progress.progress_message,
      p_total_items: progress.total_items,
      p_processed_items: progress.processed_items,
      p_successful_items: progress.successful_items,
      p_failed_items: progress.failed_items
    });

  if (error) {
    console.error(`Failed to update batch progress: ${error.message}`);
  }
}

/**
 * Adds an item to a batch job
 * @param supabase - Supabase client
 * @param jobId - ID of the job
 * @param item - Item data
 * @returns ID of the created batch item
 */
export async function addBatchItem(supabase: any, jobId: string, item: any) {
  const { data, error } = await supabase
    .schema('core')
    .rpc('add_batch_item', {
      p_job_id: jobId,
      p_item_type: item.item_type,
      p_item_id: item.item_id,
      p_status: item.status,
      p_metadata: item.metadata
    });

  if (error) {
    throw new Error(`Failed to add batch item: ${error.message}`);
  }

  return data;
}

/**
 * Updates the status of a batch item
 * @param supabase - Supabase client
 * @param itemId - ID of the item to update
 * @param status - New status
 * @param result - Result data
 */
export async function updateBatchItemStatus(supabase: any, itemId: string, status: string, result?: any) {
  const { error } = await supabase
    .schema('core')
    .rpc('update_batch_item_status', {
      p_item_id: itemId,
      p_status: status,
      p_result: result
    });

  if (error) {
    console.error(`Failed to update batch item status: ${error.message}`);
  }
}
