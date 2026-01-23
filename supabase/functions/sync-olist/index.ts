// Edge Function: olist-integration

interface OlistItem {
  sku?: string;
  name?: string;
  quantity?: number;
  unit_price?: number;
}

interface OlistOrder {
  order_id: string;
  order_number?: string;
  sale_date?: string;
  expected_date?: string;
  status?: string;
  customer?: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    cpf_cnpj?: string;
  };
  shipping?: {
    address?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    recipient_name?: string;
    recipient_cpf_cnpj?: string;
    phone?: string;
  };
  items?: OlistItem[];
  tracking_code?: string;
  notes?: string;
  total?: number;
  created_at?: string;
}

const OLIST_API_URL = 'https://api.olist.com/v1/orders';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// AQUI ESTÁ A CORREÇÃO IMPORTANTE:
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in environment');
}

Deno.serve(async (req: Request) => {
  try {
    const triggerToken = Deno.env.get('OLIST_TRIGGER_TOKEN');
    if (triggerToken) {
      const authHeader = req.headers.get('authorization') || '';
      if (!authHeader.toLowerCase().startsWith('bearer ') || authHeader.split(' ')[1] !== triggerToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    }

    const olistKey = Deno.env.get('OLIST_API_KEY');
    if (!olistKey) {
      return new Response(JSON.stringify({ error: 'Missing OLIST_API_KEY secret' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const url = new URL(req.url);
    const since = url.searchParams.get('since');

    const olistUrl = new URL(OLIST_API_URL);
    if (since) olistUrl.searchParams.set('since', since);

    const olistResp = await fetch(olistUrl.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${olistKey}`,
        'Accept': 'application/json',
      },
    });

    if (!olistResp.ok) {
      const text = await olistResp.text();
      console.error('Olist API error:', olistResp.status, text);
      return new Response(JSON.stringify({ error: 'Error fetching from Olist', detail: text }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const orders: OlistOrder[] = await olistResp.json();

    const rows: any[] = [];
    const errors: { order_id?: string; error: string }[] = [];
    for (const o of orders) {
      try {
        if (!o.order_id) {
          errors.push({ order_id: undefined, error: 'missing order_id' });
          continue;
        }

        const firstItem = (o.items && o.items.length > 0) ? o.items[0] : undefined;
        const sale_date = o.sale_date ? (new Date(o.sale_date)).toISOString().slice(0, 10) : null;
        const expected_date = o.expected_date ? (new Date(o.expected_date)).toISOString().slice(0, 10) : null;
        const quantity = firstItem?.quantity ?? 0;
        const unit_price = firstItem?.unit_price ?? (o.total ?? 0);

        const row = {
          external_id: o.order_id,
          order_number: o.order_number ?? null,
          sale_date,
          expected_date,
          status: o.status ?? null,
          notes: o.notes ?? null,
          contact_id: o.customer?.id ?? null,
          contact_name: o.customer?.name ?? null,
          cpf_cnpj: o.customer?.cpf_cnpj ?? null,
          email: o.customer?.email ?? null,
          phone: o.customer?.phone ?? null,
          zip_code: o.shipping?.zip_code ?? null,
          address: o.shipping?.address ?? null,
          address_number: o.shipping?.number ?? null,
          complement: o.shipping?.complement ?? null,
          neighborhood: o.shipping?.neighborhood ?? null,
          city: o.shipping?.city ?? null,
          state: o.shipping?.state ?? null,
          product_id_external: firstItem?.sku ?? null,
          sku: firstItem?.sku ?? null,
          description: firstItem?.name ?? null,
          quantity: Number(quantity ?? 0),
          unit_price: Number(unit_price ?? 0),
          order_freight: 0,
          order_expenses: 0,
          tracking_code: o.tracking_code ?? null,
          recipient_name: o.shipping?.recipient_name ?? o.shipping?.address ?? null,
          recipient_cpf_cnpj: o.shipping?.recipient_cpf_cnpj ?? null
        };

        rows.push(row);
      } catch (err) {
        errors.push({ order_id: o.order_id, error: String(err) });
      }
    }

    if (rows.length === 0) {
      return new Response(JSON.stringify({ message: 'No orders to upsert', orders_read: orders.length, errors }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const restUrl = `${SUPABASE_URL}/rest/v1/sales_history?on_conflict=external_id`;
    const upsertResp = await fetch(restUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(rows),
    });

    if (!upsertResp.ok) {
      const text = await upsertResp.text();
      console.error('Supabase REST upsert error:', upsertResp.status, text);
      return new Response(JSON.stringify({ error: 'Error upserting to Supabase', detail: text }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await upsertResp.json();

    return new Response(JSON.stringify({
      message: 'Upsert completed',
      orders_read: orders.length,
      rows_sent: rows.length,
      upserted_count: Array.isArray(result) ? result.length : null,
      errors
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Function error', err);
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
