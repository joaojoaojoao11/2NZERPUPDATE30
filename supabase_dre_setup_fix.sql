-- DRE SETUP SCRIPT - FIX PERMISSIONS
-- Run this in your Supabase SQL Editor to FIX the 401 Error

-- 1. Drop existing policy to avoid conflicts
DROP POLICY IF EXISTS "Allow full access to dre_mappings" ON dre_category_mappings;

-- 2. Create a more permissive policy (Allowing anon + authenticated)
-- This fixes the 401 Unauthorized error if your session isn't fully authenticated locally
CREATE POLICY "Allow public access to dre_mappings"
ON dre_category_mappings
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 3. Ensure RLS is enabled (just to be safe)
ALTER TABLE dre_category_mappings ENABLE ROW LEVEL SECURITY;
