// TF-IDF + cosine scoring (mirrors pipeline/score.py)
const MIN_SCORE = 0.04;
const BOTH_MARGIN = 0.03;

const STOP = new Set(("a an and are as at be but by for from has have in is it its of on or that the their this to was were will with you your we our " +
  "i me my not can able also etc using use used").split(" "));

export function normalize(t) {
  return String(t || "").toLowerCase().replace(/[‐‑]/g, "-")
    .replace(/[^a-z0-9+#.\- /]/g, " ").replace(/\s+/g, " ").trim();
}

function terms(doc) {
  const toks = (doc.match(/[\w+#.\-]{2,}/g) || [])
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, "")).filter((t) => t.length >= 2 && !STOP.has(t));
  const out = [...toks];
  for (let i = 0; i < toks.length - 1; i++) out.push(toks[i] + " " + toks[i + 1]);
  return out;
}

export function jdText(jd) {
  const kw = jd.keywords || [];
  return normalize([jd.title, ...(jd.must_have_skill || jd.must_have_skills || []), ...(jd.nice_to_have_skills || []), ...kw, ...kw].join(" . "));
}

export function candidateText(c) {
  const s = (c.skills_found || []).join(" ");
  return normalize([s, s, c.summary || ""].join(" . "));
}

function fit(docs) {
  const df = new Map();
  const tokenized = docs.map(terms);
  tokenized.forEach((ts) => new Set(ts).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const n = docs.length;
  const idf = new Map();
  df.forEach((d, t) => idf.set(t, Math.log((1 + n) / (1 + d)) + 1));
  return { idf, tokenized };
}

function vectorize(ts, idf) {
  const tf = new Map();
  ts.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  const v = new Map();
  let norm = 0;
  tf.forEach((c, t) => {
    const w = (1 + Math.log(c)) * idf.get(t);
    v.set(t, w);
    norm += w * w;
  });
  norm = Math.sqrt(norm) || 1;
  v.forEach((w, t) => v.set(t, w / norm));
  return v;
}

function dot(a, b) {
  let s = 0;
  const contrib = [];
  a.forEach((w, t) => {
    if (b.has(t)) {
      const c = w * b.get(t);
      s += c;
      contrib.push([t, Math.round(c * 1e4) / 1e4]);
    }
  });
  contrib.sort((x, y) => y[1] - x[1]);
  return { s, top: contrib.slice(0, 8) };
}

function experienceCheck(years, jd) {
  const lo = jd.min_years, hi = jd.max_years;
  if (lo == null) return "n/a";
  if (years == null) return "unknown";
  if (years < lo) return `below range (${years} < ${lo})`;
  if (hi != null && years > hi) return `above range (${years} > ${hi})`;
  return "within range";
}

function classify(scores) {
  const r = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [r1, s1] = r[0];
  const [r2, s2] = r[1] || [null, 0];
  if (s1 < MIN_SCORE) return ["uncertain", `best score ${(s1*100).toFixed(1)} < ${MIN_SCORE*100}`];
  if (r2 && s2 >= MIN_SCORE && s1 - s2 <= BOTH_MARGIN) return ["both", `${r1}=${(s1*100).toFixed(1)} and ${r2}=${(s2*100).toFixed(1)} within ${BOTH_MARGIN*100} points`];
  return [r1, `${r1}=${(s1*100).toFixed(1)} beats ${r2}=${(s2*100).toFixed(1)}`];
}

function warningsFor(c) {
  const w = [...(c.warnings || [])];
  if (!c.skills_found || c.skills_found.length === 0) w.push("No skills extracted");
  if (!c.summary) w.push("No summary extracted");
  if (c.years_of_experience == null) w.push("Years of experience missing");
  return w;
}

export function scoreAll(candidates, jds) {
  const cDocs = candidates.map(candidateText);
  const jDocs = jds.map(jdText);
  const { idf, tokenized } = fit([...cDocs, ...jDocs]);
  const vecs = tokenized.map((ts) => vectorize(ts, idf));
  const cv = vecs.slice(0, candidates.length);
  const jv = vecs.slice(candidates.length);
  const roleIds = jds.map((j) => j.role_id);

  const results = candidates.map((c, i) => {
    const scores = {};
    jds.forEach((jd, k) => {
      const { s, top } = dot(cv[i], jv[k]);
      const kws = jd.keywords || [];
      const hits = kws.filter((x) => cDocs[i].includes(normalize(x)));
      scores[jd.role_id] = {
        tfidf_score: Math.round(s * 1e4) / 1e4,
        keyword_hits: hits,
        keyword_missing: kws.filter((x) => !hits.includes(x)),
        keyword_coverage: Math.round((hits.length / Math.max(1, kws.length)) * 1000) / 1000,
        top_matching_terms: top,
        experience_check: experienceCheck(c.years_of_experience, jd),
        projects_ok: (c.projects_count || 0) >= (jd.min_projects || 0),
      };
    });
    const [label, reason] = classify(Object.fromEntries(roleIds.map((r) => [r, scores[r].tfidf_score])));
    return {
      candidate_name: c.candidate_name,
      llm_assigned_role: c.assigned_role,
      years_of_experience: c.years_of_experience,
      projects_count: c.projects_count,
      skills_found: c.skills_found || [],
      summary: c.summary || "",
      is_upload: !!c.is_upload,
      warnings: warningsFor(c),
      classification: label,
      classification_reason: reason,
      scores,
    };
  });

  roleIds.forEach((r) => {
    [...results].sort((a, b) => b.scores[r].tfidf_score - a.scores[r].tfidf_score)
      .forEach((x, i) => (x.scores[r].rank = i + 1));
  });
  return { results, roles: jds.map((j) => ({ role_id: j.role_id, title: j.title })) };
}