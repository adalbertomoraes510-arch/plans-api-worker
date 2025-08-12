import { neon } from "@neondatabase/serverless";

// CORS helper
function corsHeaders(origin) {
  const o = origin || "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-API-Key"
  };
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env.CORS_ORIGIN) });
    }

    const url = new URL(req.url);
    const send = (status, data) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders(env.CORS_ORIGIN) }
      });

    // Segurança simples via API Key (defina em Secrets do Worker)
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey || apiKey !== env.API_KEY) {
      return send(401, { error: "unauthorized" });
    }

    // Conexão ao Postgres (Neon)
    const sql = neon(env.DATABASE_URL);

    try {
      if (url.pathname === "/health") {
        return send(200, { ok: true });
      }

      // Plans
      if (url.pathname === "/plans" && req.method === "GET") {
        const rows = await sql`SELECT id, name, status, created_at FROM plans ORDER BY id DESC`;
        return send(200, rows);
      }

      if (url.pathname === "/plans" && req.method === "POST") {
        const body = await req.json();
        const { name, status = 'ativo' } = body || {};
        if (!name) return send(400, { error: "name is required" });
        const rows = await sql`
          INSERT INTO plans (name, status) VALUES (${name}, ${status})
          RETURNING id, name, status, created_at
        `;
        return send(201, rows[0]);
      }

      // Steps
      if (url.pathname.startsWith("/plans/") && url.pathname.endsWith("/steps") && req.method === "GET") {
        const planId = url.pathname.split("/")[2];
        const rows = await sql`
          SELECT id, plan_id, title, owner, start_due, end_due, start_real, end_real,
                 pct_planned, pct_real, status, position, created_at
          FROM steps WHERE plan_id = ${planId} ORDER BY position NULLS LAST, id
        `;
        return send(200, rows);
      }

      if (url.pathname === "/steps" && req.method === "POST") {
        const b = await req.json();
        const {
          plan_id, title, owner = null,
          start_due = null, end_due = null,
          start_real = null, end_real = null,
          pct_planned = null, pct_real = null,
          status = 'pendente', position = null
        } = b || {};
        if (!plan_id || !title) return send(400, { error: "plan_id and title are required" });
        const rows = await sql`
          INSERT INTO steps (plan_id, title, owner, start_due, end_due, start_real, end_real,
                             pct_planned, pct_real, status, position)
          VALUES (${plan_id}, ${title}, ${owner}, ${start_due}, ${end_due}, ${start_real}, ${end_real},
                  ${pct_planned}, ${pct_real}, ${status}, ${position})
          RETURNING *
        `;
        return send(201, rows[0]);
      }

      if (url.pathname.startsWith("/steps/") && req.method === "PUT") {
        const id = url.pathname.split("/")[2];
        const b = await req.json();
        const fields = [];
        for (const k of ["title","owner","start_due","end_due","start_real","end_real","pct_planned","pct_real","status","position"]) {
          if (k in b) { fields.push(sql`${sql.unsafe(k)} = ${b[k]}`); }
        }
        if (!fields.length) return send(400, { error: "no fields to update" });
        const rows = await sql`UPDATE steps SET ${sql.join(fields, sql`, `)} WHERE id = ${id} RETURNING *`;
        return rows.length ? send(200, rows[0]) : send(404, { error: "not found" });
      }

      return send(404, { error: "route not found" });
    } catch (err) {
      return send(500, { error: "internal", detail: String(err?.message || err) });
    }
  }
};
