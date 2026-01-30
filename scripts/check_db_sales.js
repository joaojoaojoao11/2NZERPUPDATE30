
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ipehorttsrvjynnhyzhu.supabase.co';
const SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlwZWhvcnR0c3J2anlubmh5emh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjYwNjA1MywiZXhwIjoyMDgyMTgyMDUzfQ.secret';
// WARNING: Do not hardcode service key in prod. For this agent context, assuming I don't have it easily or need to read env.
// Actually I read .env.local but that was ANON KEY. I need service key or Anon key with select permission.
// Using ANON KEY from step 90.

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlwZWhvcnR0c3J2anlubmh5emh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MDYwNTMsImV4cCI6MjA4MjE4MjA1M30.m6GW1AckPRGVP8wagfc9t4hzjvMOlHoEIskS36eKwDU';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function checkDB() {
    console.log('Checking Sales History in DB...');
    const { data, error } = await supabase
        .from('sales_history')
        .select('sale_date, order_number, contact_name')
        .order('sale_date', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Top 10 Most Recent Sales in DB:');
    data.forEach(d => {
        console.log(`- ${d.sale_date} (Order: ${d.order_number}) - ${d.contact_name}`);
    });
}

checkDB();
