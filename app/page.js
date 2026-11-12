"use client";
import { useEffect, useMemo, useState } from "react";

const pillClass = (c) => (c === "both" ? "both" : c === "uncertain" ? "uncertain" : /lca/i.test(c) ? "lca" : "ux");

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(null);
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [sel, setSel] = useState(null);
  const [newName, setNewName] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/results")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setTab(d.roles[0].role_id);
      })
      .catch((e) => setError("Could not load results: " + e.message));
  }, []);

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed");
      setData({ roles: d.roles, results: d.results });
      setNewName(d.new_candidate);
      setSel(d.new_candidate);
      const me = d.results.find((x) => x.candidate_name === d.new_candidate);
      setMsg(
        `"${d.new_candidate}" added. ` +
          d.roles.map((r) => `${r.title}: rank #${me.scores[r.role_id].rank} of ${d.total}`).join(" | ") +
          ` | classified: ${me.classification}`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  const rows = useMemo(() => {
    if (!data || !tab) return [];
    let r = data.results.filter((x) => {
      const s = x.scores[tab].tfidf_score;
      if (s * 100 < minScore) return false;
      if (cls !== "all" && x.classification !== cls) return false;
      if (q && !(x.candidate_name + " " + x.skills_found.join(" ")).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    const val = (x) =>
      sortKey === "score" ? x.scores[tab].tfidf_score
      : sortKey === "years" ? x.years_of_experience ?? -1
      : sortKey === "coverage" ? x.scores[tab].keyword_coverage
      : x.candidate_name.toLowerCase();
    r = [...r].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0));
    return sortDir === "asc" ? r : r.reverse();
  }, [data, tab, sortKey, sortDir, q, cls, minScore]);

  const head = (key, label) => (
    <th onClick={() => { setSortDir(sortKey === key && sortDir === "desc" ? "asc" : "desc"); setSortKey(key); }}>
      {label}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  if (!data) return <div className="wrap">{error ? <div className="err">{error}</div> : "Loading…"}</div>;

  const role = data.roles.find((r) => r.role_id === tab);
  const selected = data.results.find((x) => x.candidate_name === sel);
  const withWarnings = data.results.filter((x) => x.warnings.length).length;

  return (
    <div className="wrap">
      <h1>Resume Ranker</h1>
      <p className="sub">
        {data.results.length} resumes · ranked per role by TF-IDF cosine similarity between resume text (skills + summary) and the job description.
      </p>

      {error && <div className="err">{error}</div>}
      {msg && <div className="ok">{msg}</div>}
      {withWarnings > 0 && <div className="warn">{withWarnings} resume(s) have extraction warnings — click a row to see what happened.</div>}

      <div className="bar">
        {data.roles.map((r) => (
          <button key={r.role_id} className={"tab" + (tab === r.role_id ? " on" : "")} onClick={() => setTab(r.role_id)}>
            {r.title}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <label className="tab" style={{ cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Scoring…" : "⬆ Upload new resume (PDF/TXT)"}
          <input type="file" accept=".pdf,.txt,.md" onChange={upload} disabled={busy} style={{ display: "none" }} />
        </label>
      </div>

      <div className="bar">
        <input placeholder="Search name or skill…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="all">All classifications</option>
          {data.roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.role_id}</option>)}
          <option value="both">both</option>
          <option value="uncertain">uncertain</option>
        </select>
        <label className="muted">
          Min score{" "}
          <input type="number" step="5" min="0" max="100" value={minScore} onChange={(e) => setMinScore(parseFloat(e.target.value) || 0)} style={{ width: 70 }} />
        </label>
        <span className="muted">{rows.length} shown</span>
      </div>

      <div className="grid">
        <div className="card scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                {head("name", "Candidate")}
                {head("score", "Score")}
                {head("years", "Yrs")}
                {head("coverage", "Keywords")}
                <th>Class</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const s = x.scores[tab];
                return (
                  <tr key={x.candidate_name}
                      className={"row" + (sel === x.candidate_name ? " sel" : "") + (newName === x.candidate_name ? " new" : "")}
                      onClick={() => setSel(x.candidate_name)}>
                    <td>{s.rank}</td>
                    <td>{x.candidate_name}{x.is_upload && <span className="pill both" style={{ marginLeft: 6 }}>new</span>}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <b>{(s.tfidf_score * 100).toFixed(1)}</b>
                        <div className="bar-s" style={{ width: 80 }}><i style={{ width: `${Math.min(100, s.tfidf_score * 100)}%` }} /></div>
                      </div>
                    </td>
                    <td>{x.years_of_experience ?? "—"}</td>
                    <td>{Math.round(s.keyword_coverage * 100)}%</td>
                    <td><span className={"pill " + pillClass(x.classification)}>{x.classification}</span></td>
                    <td>{x.warnings.length > 0 && <span title={x.warnings.join("; ")}>⚠</span>}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="muted">No candidates match the filters.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          {!selected ? (
            <p className="muted">Select a candidate to see the extracted data, ranking logic and source resume.</p>
          ) : (
            <Detail c={selected} roles={data.roles} tab={tab} total={data.results.length} />
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>How ranking works — {role.title}</h3>
        <p className="muted" style={{ margin: 0 }}>
          Score (0-100) = cosine similarity of TF-IDF vectors x 100 (unigrams + bigrams) between the candidate&apos;s skills/summary and this role&apos;s JD
          (title, must-haves, nice-to-haves, keywords). Classification: <b>uncertain</b> if best score is below 4, <b>both</b> if the top two scores are within 3 points,
          otherwise the higher-scoring role. Years and project checks are shown as evidence but do not change the score.
        </p>
      </div>
    </div>
  );
}

function Detail({ c, roles, tab, total }) {
  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>{c.candidate_name}</h2>
      <div>
        <span className={"pill " + pillClass(c.classification)}>{c.classification}</span>{" "}
        <span className="muted">{c.classification_reason}</span>
      </div>
      {!c.is_upload && (
        <p style={{ margin: "8px 0" }}>
          <a href={`/resumes/${encodeURIComponent(c.candidate_name)}.pdf`} target="_blank" rel="noreferrer">Open source resume ↗</a>
        </p>
      )}
      {c.warnings.map((w, i) => <div key={i} className="warn">⚠ {w}</div>)}

      <h3>Extracted</h3>
      <div>Years of experience: <b>{c.years_of_experience ?? "unknown"}</b> · Projects: <b>{c.projects_count ?? "unknown"}</b></div>
      {c.llm_assigned_role && <div className="muted">Original AI label: {c.llm_assigned_role}</div>}
      <p>{c.summary || <span className="muted">No summary</span>}</p>
      <div>{c.skills_found.length ? c.skills_found.map((s) => <span key={s} className="tag skill">{s}</span>) : <span className="muted">No skills found</span>}</div>

      {roles.map((r) => {
        const s = c.scores[r.role_id];
        return (
          <div key={r.role_id} style={{ opacity: r.role_id === tab ? 1 : 0.75 }}>
            <h3>{r.title} — rank #{s.rank} of {total} · score {(s.tfidf_score * 100).toFixed(1)} / 100</h3>
            <div>Experience: {s.experience_check} · Projects requirement {s.projects_ok ? "met" : "not met"}</div>
            <div style={{ margin: "4px 0" }}>
              {s.keyword_hits.map((k) => <span key={k} className="tag hit">✓ {k}</span>)}
              {s.keyword_missing.map((k) => <span key={k} className="tag miss">✗ {k}</span>)}
            </div>
            {s.top_matching_terms.length > 0 && (
              <div className="muted">Top matching terms: {s.top_matching_terms.map(([t, v]) => `${t} (${(v * 100).toFixed(1)})`).join(", ")}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}