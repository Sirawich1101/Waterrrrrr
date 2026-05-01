-- ============================================================================
-- SmartMeter — Supabase Setup Script
-- ============================================================================
-- Run this entire script in the Supabase SQL Editor (Dashboard → SQL Editor).
--
-- ⚠️  WARNING: The RLS policies below are PUBLIC (no auth check).
--     This is for MVP / demo purposes ONLY.
--     After adding user authentication, replace these with:
--       USING (auth.uid() = user_id)
--       WITH CHECK (auth.uid() = user_id)
-- ============================================================================


-- ─── 1. CREATE TABLE ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meter_records (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    meter_id        TEXT NOT NULL,
    reading_value   TEXT,
    image_url       TEXT,
    meter_condition TEXT,
    location_name   TEXT,
    time_period     TEXT,
    inspector_name  TEXT,
    notes           TEXT,
    status          TEXT DEFAULT 'รอตรวจสอบ',
    ai_raw_response TEXT,
    ai_confidence   REAL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Add a comment to the table for documentation
COMMENT ON TABLE meter_records IS 'Stores water meter reading records captured by SmartMeter app';


-- ─── 2. ENABLE ROW LEVEL SECURITY ───────────────────────────────────────────

ALTER TABLE meter_records ENABLE ROW LEVEL SECURITY;


-- ─── 3. RLS POLICIES (PUBLIC — DEMO ONLY) ───────────────────────────────────
-- ⚠️  These policies allow ANY anonymous user to read/write.
--     Replace with auth-based policies before going to production.

-- Allow anyone to SELECT (read) all records
CREATE POLICY "Public read access (DEMO ONLY)"
    ON meter_records
    FOR SELECT
    USING (true);

-- Allow anyone to INSERT new records
CREATE POLICY "Public insert access (DEMO ONLY)"
    ON meter_records
    FOR INSERT
    WITH CHECK (true);

-- Allow anyone to UPDATE existing records
CREATE POLICY "Public update access (DEMO ONLY)"
    ON meter_records
    FOR UPDATE
    USING (true)
    WITH CHECK (true);


-- ─── 4. STORAGE BUCKET ──────────────────────────────────────────────────────
-- Create the 'meter-images' bucket for uploaded meter photos.
-- Run this via Supabase Dashboard → Storage → New bucket:
--   Name: meter-images
--   Public: true
--
-- OR use the SQL below (requires service_role access):

INSERT INTO storage.buckets (id, name, public)
VALUES ('meter-images', 'meter-images', true)
ON CONFLICT (id) DO NOTHING;


-- ─── 5. STORAGE POLICIES (PUBLIC — DEMO ONLY) ───────────────────────────────
-- ⚠️  These policies allow ANY anonymous user to upload/view images.
--     Restrict after adding authentication.

-- Allow anyone to upload files to meter-images
CREATE POLICY "Public upload to meter-images (DEMO ONLY)"
    ON storage.objects
    FOR INSERT
    WITH CHECK (bucket_id = 'meter-images');

-- Allow anyone to view/download files from meter-images
CREATE POLICY "Public read from meter-images (DEMO ONLY)"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'meter-images');

-- Allow anyone to update files in meter-images (e.g., overwrite)
CREATE POLICY "Public update in meter-images (DEMO ONLY)"
    ON storage.objects
    FOR UPDATE
    USING (bucket_id = 'meter-images')
    WITH CHECK (bucket_id = 'meter-images');


-- ============================================================================
-- ✅ Done! After running this script:
-- 1. Verify the table exists in Table Editor
-- 2. Verify the bucket exists in Storage
-- 3. Test from the frontend
--
-- 🔒 REMINDER: Lock down these policies before production use!
-- ============================================================================
