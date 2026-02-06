
-- Garantir created_at
DO $$
BEGIN
    ALTER TABLE public.collection_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;
EXCEPTION
    WHEN duplicate_column THEN RAISE NOTICE 'column created_at already exists.';
END;
$$;

NOTIFY pgrst, 'reload schema';
