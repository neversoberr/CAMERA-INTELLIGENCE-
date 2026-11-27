import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const menu = [
  ["Overview", "/overview"], ["Centres", "/centres"], ["Cameras", "/cameras"],
  ["Occupancy monitor", "/"], ["Alerts", "/alerts"], ["Reports", "/reports"],
  ["Branch connections", "/connectors"], ["Settings", "/settings"]
];

export default async function Home() {
  let centreCount = "14";
  let cameraCount = "0";
  let connectorCount = "0";
  let supabaseReady = false;

  try {
    const supabase = createClient();
    const [centres, cameras, connectors] = await Promise.all([
      supabase.from("centres").select("*", { count: "exact", head: true }),
      supabase.from("cameras").select("*", { count: "exact", head: true }),
      supabase.from("branch_connectors").select("*", { count: "exact", head: true })
    ]);
    if (!centres.error && !cameras.error && !connectors.error) {
      centreCount = String(centres.count ?? 0);
      cameraCount = String(cameras.count ?? 0);
      connectorCount = String(connectors.count ?? 0);
      supabaseReady = true;
    }
  } catch {}

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">ASSURE<small>CCTV INTELLIGENCE</small></div>
      <nav className="nav">{menu.map(([label, href], i) => <Link className={i===0?"active":""} href={href} key={href}>{label}</Link>)}</nav>
      <p className="muted" style={{color:"#aeb4bd",marginTop:36}}>Admin workspace</p>
    </aside>
    <main className="main">
      <div className="topbar">
        <div><div className="eyebrow">Central monitoring</div><h1>Overview</h1><div className="muted">Assure Clinic · Nationwide camera operations</div></div>
        <div className="header-actions"><span className="pill">Admin</span></div>
      </div>
      <div className="grid">
        <div className="card"><div className="muted">Centres registered</div><div className="metric">{centreCount}</div></div>
        <div className="card"><div className="muted">Cameras registered</div><div className="metric">{cameraCount}</div></div>
        <div className="card"><div className="muted">Branch connectors</div><div className="metric">{connectorCount}</div></div>
        <div className="card"><div className="muted">Active alerts</div><div className="metric">—</div></div>
      </div>
      <section className="section panel">
        <h2>System setup status</h2>
        <p><span className="pill pending">{supabaseReady ? "Database connected" : "Database setup pending"}</span></p>
        <p className="muted">The registry does not receive frames or results from the local occupancy monitor. Counts come from onboarded devices.</p>
      </section>
      <section className="section card">
        <h2>Deployment sequence</h2>
        <div className="table-wrap"><table className="table"><thead><tr><th>Stage</th><th>Status</th><th>Next action</th></tr></thead>
        <tbody>
          <tr><td>Admin dashboard</td><td><span className="pill">Starter scaffold</span></td><td>Configure Supabase</td></tr>
          <tr><td>Centre and camera registry</td><td><span className="pill pending">Pending</span></td><td>Run database schema</td></tr>
          <tr><td>Branch connector</td><td><span className="pill pending">Pending</span></td><td>Install on pilot PC</td></tr>
          <tr><td>Branch occupancy events</td><td><span className="pill pending">Pending</span></td><td>Validate camera stream</td></tr>
        </tbody></table></div>
      </section>
      <p className="muted" style={{marginTop:22}}>Prototype only. Authentication enforcement and production admin policies must be completed before deployment or use with real camera feeds.</p>
    </main>
  </div>;
}
