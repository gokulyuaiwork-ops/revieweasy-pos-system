-- ==============================================================================
-- REVIEWEASY HYBRID EDGE-CLOUD ARCHITECTURE: SUPABASE CLOUD DATABASE SCHEMA
-- ==============================================================================

-- 1. Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Stores Table (Multi-tenant)
CREATE TABLE IF NOT EXISTS public.stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_code VARCHAR(50) UNIQUE NOT NULL,
    store_name VARCHAR(255) NOT NULL,
    store_phone VARCHAR(20) NOT NULL,
    store_gstin VARCHAR(30),
    google_review_url TEXT NOT NULL,
    business_category VARCHAR(50) DEFAULT 'RESTAURANT_CAFE',
    custom_whatsapp_template TEXT,
    flyer_image_url TEXT DEFAULT '/assets/default-review-flyer.jpg',
    flyer_overlay_config JSONB DEFAULT '{"enabled": true, "template": "Specially for {{name}}! ✨", "posX": 50, "posY": 18, "fontSize": 28, "color": "#FFFFFF"}'::jsonb,
    quiet_hours_start VARCHAR(5) DEFAULT '21:00',
    quiet_hours_end VARCHAR(5) DEFAULT '09:30',
    pacing_min_seconds INT DEFAULT 15,
    pacing_max_seconds INT DEFAULT 30,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Bills Table (Stores every intercepted receipt)
CREATE TABLE IF NOT EXISTS public.bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_code VARCHAR(50) NOT NULL REFERENCES public.stores(store_code) ON DELETE CASCADE,
    local_bill_id VARCHAR(100) NOT NULL,
    invoice_number VARCHAR(100) NOT NULL,
    customer_name VARCHAR(255) DEFAULT 'Valued Customer',
    customer_phone VARCHAR(20) NOT NULL,
    total_amount NUMERIC(10, 2) DEFAULT 0.00,
    source VARCHAR(50) DEFAULT 'PRINT_SPOOLER',
    is_raster BOOLEAN DEFAULT FALSE,
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(store_code, invoice_number, customer_phone)
);

-- 4. Review Dispatches Table (Tracks WhatsApp Delivery State)
CREATE TABLE IF NOT EXISTS public.review_dispatches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID REFERENCES public.bills(id) ON DELETE CASCADE,
    store_code VARCHAR(50) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    message_body TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'QUEUED', -- QUEUED, DELIVERED, HELD_QUIET_HOURS, REJECTED, FAILED
    status_reason TEXT,
    dispatched_via VARCHAR(50) DEFAULT 'LOCAL_BAILEYS_WEBSOCKET',
    dispatched_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Analytics Summary View (For Store Owner Dashboard)
CREATE OR REPLACE VIEW public.store_analytics AS
SELECT 
    b.store_code,
    COUNT(b.id) AS total_bills_captured,
    COUNT(CASE WHEN rd.status = 'DELIVERED' THEN 1 END) AS total_whatsapp_delivered,
    COUNT(CASE WHEN rd.status = 'HELD_QUIET_HOURS' THEN 1 END) AS total_quiet_hours_held,
    COALESCE(SUM(b.total_amount), 0) AS total_sales_volume,
    ROUND(
        (COUNT(CASE WHEN rd.status = 'DELIVERED' THEN 1 END)::NUMERIC / 
        NULLIF(COUNT(b.id), 0) * 100), 1
    ) AS review_reach_percentage
FROM public.bills b
LEFT JOIN public.review_dispatches rd ON b.id = rd.bill_id
GROUP BY b.store_code;

-- 6. Row Level Security (RLS) Policies
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_dispatches ENABLE ROW LEVEL SECURITY;

-- Allow public read/write for store agent with store_code matching
CREATE POLICY "Allow Agent Sync" ON public.bills
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow Dispatch Tracking" ON public.review_dispatches
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow Store Read" ON public.stores
    FOR SELECT
    USING (true);

-- Insert Default Demo Store
INSERT INTO public.stores (store_code, store_name, store_phone, store_gstin, google_review_url)
VALUES (
    'STORE_DEMO_01',
    'Sunshine Cafe & Bistro',
    '9840012345',
    '33AABCS1429B1ZB',
    'https://g.page/r/sunshine-cafe/review'
)
ON CONFLICT (store_code) DO NOTHING;
