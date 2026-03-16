
-- RPC: Get Notification Templates
CREATE OR REPLACE FUNCTION core.get_notification_templates()
RETURNS SETOF core.notification_templates
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY 
    SELECT * FROM core.notification_templates 
    ORDER BY created_at DESC;
END;
$$;

-- RPC: Create Notification Template
CREATE OR REPLACE FUNCTION core.create_notification_template(p_template JSONB)
RETURNS core.notification_templates
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result core.notification_templates;
BEGIN
    INSERT INTO core.notification_templates (
        name, title, body, category, data, image_url, variables, is_active
    ) VALUES (
        p_template->>'name',
        p_template->>'title',
        p_template->>'body',
        p_template->>'category',
        COALESCE(p_template->'data', '{}'::jsonb),
        p_template->>'image_url',
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_template->'variables', '[]'::jsonb))),
        COALESCE((p_template->>'is_active')::boolean, true)
    )
    RETURNING * INTO v_result;
    
    RETURN v_result;
END;
$$;

-- RPC: Update Notification Template
CREATE OR REPLACE FUNCTION core.update_notification_template(p_id UUID, p_updates JSONB)
RETURNS core.notification_templates
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result core.notification_templates;
BEGIN
    UPDATE core.notification_templates
    SET
        name = COALESCE(p_updates->>'name', name),
        title = COALESCE(p_updates->>'title', title),
        body = COALESCE(p_updates->>'body', body),
        category = COALESCE(p_updates->>'category', category),
        data = COALESCE(p_updates->'data', data),
        image_url = COALESCE(p_updates->>'image_url', image_url),
        is_active = COALESCE((p_updates->>'is_active')::boolean, is_active),
        updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_result;
    
    RETURN v_result;
END;
$$;

-- RPC: Delete Notification Template
CREATE OR REPLACE FUNCTION core.delete_notification_template(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM core.notification_templates WHERE id = p_id;
END;
$$;

-- RPC: Get Notification Logs
CREATE OR REPLACE FUNCTION core.get_notification_logs(p_limit INTEGER DEFAULT 50)
RETURNS SETOF core.notification_logs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY 
    SELECT * FROM core.notification_logs 
    ORDER BY sent_at DESC 
    LIMIT p_limit;
END;
$$;

-- Public wrappers for easy access
CREATE OR REPLACE FUNCTION public.get_notification_templates() RETURNS SETOF core.notification_templates AS $$ SELECT * FROM core.get_notification_templates(); $$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION public.get_notification_logs(p_limit INTEGER DEFAULT 50) RETURNS SETOF core.notification_logs AS $$ SELECT * FROM core.get_notification_logs(p_limit); $$ LANGUAGE sql SECURITY DEFINER;

-- Grants
GRANT EXECUTE ON FUNCTION core.get_notification_templates() TO authenticated;
GRANT EXECUTE ON FUNCTION core.create_notification_template(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION core.update_notification_template(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION core.delete_notification_template(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_notification_logs(INTEGER) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_notification_templates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_logs(INTEGER) TO authenticated;
