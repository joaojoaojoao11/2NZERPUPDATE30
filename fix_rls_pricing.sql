-- Allow public access to pricing_engineering (Fixes 401 Unauthorized Error)
-- Execute this in your Supabase SQL Editor

-- Disable RLS momentarily to ensure no locks (optional, but good for debugging)
ALTER TABLE public.pricing_engineering DISABLE ROW LEVEL SECURITY;

-- Re-enable RLS
ALTER TABLE public.pricing_engineering ENABLE ROW LEVEL SECURITY;

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.pricing_engineering;
DROP POLICY IF EXISTS "Enable all for public" ON public.pricing_engineering;

-- Create a permissive policy that allows ANONYMOUS and AUTHENTICATED users to read/write
-- This addresses the "new row violates row-level security policy" error
CREATE POLICY "Enable all for public" ON public.pricing_engineering
    FOR ALL
    TO public
    USING (true)
    WITH CHECK (true);
