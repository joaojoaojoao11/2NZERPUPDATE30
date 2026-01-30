
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ipehorttsrvjynnhyzhu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlwZWhvcnR0c3J2anlubmh5emh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MDYwNTMsImV4cCI6MjA4MjE4MjA1M30.m6GW1AckPRGVP8wagfc9t4hzjvMOlHoEIskS36eKwDU';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

const TARGET_IDS = ['391768954', '392042753', '389025078']; // IDs found in debug logs (27/01, 30/01)

async function checkSpecificIDs() {
    console.log(`Checking IDs: ${TARGET_IDS.join(', ')}...`);

    // Tiny-ID-Index
    // We don't know the exact external_id without construction, but we saved 'order_number' presumably as number?
    // DataService says: orderNumber, externalId...
    // Let's search by order_number (which looks like the ID in Tiny usually, or the "Numero" field).
    // Tiny "id" is internal ID. "numero" is Order Number.
    // Debug log said "ID: 391768954". Is this ID or Number?
    // debug_tiny_pages.js: `ID: ${first.id}`.
    // Sync code: `order_number: String(p.numero)`. `external_id: TINY-${p.id}-...`.

    // So we search where external_id contains these IDs.

    for (const id of TARGET_IDS) {
        const { data, error } = await supabase
            .from('sales_history')
            .select('*')
            .ilike('external_id', `%${id}%`);

        if (error) {
            console.error(`Error checking ${id}:`, error);
        } else if (data && data.length > 0) {
            console.log(`FOUND ${id}:`);
            data.forEach(d => console.log(` - Ext: ${d.external_id} | Date: ${d.sale_date} | OrderNum: ${d.order_number}`));
        } else {
            console.log(`MISSING ${id} in DB.`);
        }
    }
}

checkSpecificIDs();
