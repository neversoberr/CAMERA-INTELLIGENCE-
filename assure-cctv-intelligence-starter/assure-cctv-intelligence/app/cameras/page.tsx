import { createClient } from "@/lib/supabase/server";
export default async function Cameras() {
  let rows: any[] = []; let error = "";
  try { const {data,error:e}=await createClient().from("cameras").select("id,name,ip_address,model,status,centres(name)").order("name"); if(e) error=e.message; else rows=data??[]; }
  catch(e:any){error=e.message;}
  return <main className="main"><div className="eyebrow">Devices</div><h1>Camera registry</h1><p className="muted">Only verified camera details should be entered here.</p>
  <section className="section card"><div className="table-wrap"><table className="table"><thead><tr><th>Camera</th><th>Centre</th><th>IP address</th><th>Model</th><th>Status</th></tr></thead><tbody>
  {rows.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.centres?.name??"—"}</td><td>{r.ip_address??"—"}</td><td>{r.model??"—"}</td><td>{r.status}</td></tr>)}
  {!rows.length&&<tr><td colSpan={5}>{error||"No cameras registered yet."}</td></tr>}
  </tbody></table></div></section></main>;
}
