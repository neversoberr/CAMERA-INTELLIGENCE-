import { createClient } from "@/lib/supabase/server";
export default async function Centres() {
  let rows: any[] = [];
  let error = "";
  try {
    const { data, error: e } = await createClient().from("centres").select("id,name,city,state,status").order("name");
    if (e) error = e.message; else rows = data ?? [];
  } catch (e: any) { error = e.message; }
  return <main className="main"><div className="eyebrow">Administration</div><h1>Centre management</h1><p className="muted">Registered clinic locations.</p>
    <section className="section card"><div className="table-wrap"><table className="table"><thead><tr><th>Centre</th><th>City</th><th>State</th><th>Status</th></tr></thead><tbody>
    {rows.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.city ?? "—"}</td><td>{r.state ?? "—"}</td><td><span className="pill">{r.status}</span></td></tr>)}
    {!rows.length && <tr><td colSpan={4}>{error || "No centres added yet. Add your verified centre list in Supabase."}</td></tr>}
    </tbody></table></div></section></main>;
}
