-- Corrida Quanta entra na conta única do site (/conta/): o progresso do jogo
-- ('quanta-corrida-profile') passa a ser salvo em quanta_progress como app 'corrida'.
-- Mesmo corpo de quanta_save_progress de conta/schema.sql, só com 'corrida' na lista.
ALTER TABLE public.quanta_progress DROP CONSTRAINT IF EXISTS quanta_progress_app_check;
ALTER TABLE public.quanta_progress ADD CONSTRAINT quanta_progress_app_check
  CHECK (app IN ('questoes','memoria-ligacoes','liga','faca-funcionar','genese','axioma','corrida'));

CREATE OR REPLACE FUNCTION public.quanta_save_progress(app text, payload jsonb, expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  owner_id uuid := auth.uid();
  current_row public.quanta_progress%ROWTYPE;
  inserted_count integer;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  IF app IS NULL OR app NOT IN ('questoes','memoria-ligacoes','liga','faca-funcionar','genese','axioma','corrida')
    OR payload IS NULL OR jsonb_typeof(payload) <> 'object'
    OR octet_length(payload::text) > 1048576
    OR expected_revision IS NULL OR expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid progress request' USING ERRCODE='22023';
  END IF;
  -- ON CONFLICT serializes simultaneous first writes using the primary key.
  IF expected_revision = 0 THEN
    INSERT INTO public.quanta_progress AS p (user_id, app, payload, revision)
      VALUES (owner_id, $1, $2, 1) ON CONFLICT ON CONSTRAINT quanta_progress_pkey DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    IF inserted_count = 1 THEN RETURN jsonb_build_object('ok',true,'revision',1); END IF;
  END IF;
  SELECT p.* INTO current_row FROM public.quanta_progress p
    WHERE p.user_id=owner_id AND p.app=$1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'conflict',true,'revision',0); END IF;
  IF current_row.revision <> expected_revision THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'revision',current_row.revision);
  END IF;
  INSERT INTO public.quanta_progress_history (user_id,app,revision,payload,updated_at)
    VALUES (owner_id,$1,current_row.revision,current_row.payload,current_row.updated_at);
  UPDATE public.quanta_progress p SET payload=$2, revision=p.revision+1, updated_at=clock_timestamp()
    WHERE p.user_id=owner_id AND p.app=$1;
  DELETE FROM public.quanta_progress_history h WHERE h.user_id=owner_id AND h.app=$1
    AND h.revision <= current_row.revision-10;
  RETURN jsonb_build_object('ok',true,'revision',current_row.revision+1);
END $$;
REVOKE ALL ON FUNCTION public.quanta_save_progress(text,jsonb,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quanta_save_progress(text,jsonb,bigint) TO authenticated;
