"""
TF-IDF cosine-similarity scoring of resumes against job descriptions.

Usage:
    python score_resumes.py --candidates candidates.json \
        --jds lca_jd.json uiux_jd.json --out results

Outputs:
    results/scores.json   full per-candidate scores, ranks, evidence, classification
    results/scores.csv    flat table for quick review / sorting
    results/ranking_<role_id>.csv   ranked list per role

Requires: pip install scikit-learn numpy
"""
import argparse
import csv
import json
import os
import re

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# ---- classification thresholds (tune after looking at your score distribution) ----
MIN_SCORE = 0.08      # below this for every role -> "uncertain"
BOTH_MARGIN = 0.03    # if top two scores are within this and both >= MIN_SCORE -> "both"


# ----------------------------------------------------------------------------- io
def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_candidates(path):
    data = load_json(path)
    if isinstance(data, dict):
        # accept {"candidates": [...]} or any single list value
        for v in data.values():
            if isinstance(v, list):
                data = v
                break
    if not isinstance(data, list):
        raise ValueError("Candidates file must contain a list of candidate objects")
    return data


# ------------------------------------------------------------------------ text prep
def normalize(text):
    text = str(text or "").lower()
    text = text.replace("\u2011", "-").replace("\u2010", "-")  # non-breaking hyphens
    text = re.sub(r"[^a-z0-9+#.\- /]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def jd_text(jd):
    """Build the JD document. Keywords/skills are repeated so they carry more weight
    than the prose-like must-have sentences."""
    parts = [jd.get("title", "")]
    parts += jd.get("must_have_skill", []) or jd.get("must_have_skills", [])
    parts += jd.get("nice_to_have_skills", [])
    kw = jd.get("keywords", [])
    parts += kw + kw  # double weight on keywords
    return normalize(" . ".join(map(str, parts)))


def candidate_text(c):
    """Candidate document. assigned_role is deliberately excluded to avoid label leakage."""
    skills = c.get("skills_found") or []
    parts = [" ".join(map(str, skills)), " ".join(map(str, skills)), c.get("summary", "")]
    return normalize(" . ".join(parts))


# ---------------------------------------------------------------------- evidence
def keyword_hits(cand_txt, jd):
    hits, misses = [], []
    for k in jd.get("keywords", []):
        (hits if normalize(k) in cand_txt else misses).append(k)
    return hits, misses


def top_terms(vec_c, vec_j, feature_names, n=8):
    """Terms contributing most to the dot product (= cosine, since vectors are L2-normed)."""
    contrib = vec_c.multiply(vec_j).toarray().ravel()
    idx = np.argsort(contrib)[::-1][:n]
    return [(feature_names[i], round(float(contrib[i]), 4)) for i in idx if contrib[i] > 0]


def experience_check(years, jd):
    lo, hi = jd.get("min_years"), jd.get("max_years")
    if lo is None:
        return "n/a"
    if years is None:
        return "unknown"
    if years < lo:
        return f"below range ({years} < {lo})"
    if hi is not None and years > hi:
        return f"above range ({years} > {hi})"
    return "within range"


def classify(scores):
    """scores: {role_id: tfidf_score}. Returns (label, reason)."""
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    (r1, s1), (r2, s2) = ranked[0], ranked[1]
    if s1 < MIN_SCORE:
        return "uncertain", f"best score {s1:.3f} < {MIN_SCORE}"
    if s2 >= MIN_SCORE and (s1 - s2) <= BOTH_MARGIN:
        return "both", f"{r1}={s1:.3f} and {r2}={s2:.3f} within {BOTH_MARGIN}"
    return r1, f"{r1}={s1:.3f} beats {r2}={s2:.3f}"


# -------------------------------------------------------------------------- main
def score(candidates, jds):
    cand_docs = [candidate_text(c) for c in candidates]
    jd_docs = [jd_text(j) for j in jds]

    # fit on everything so IDF reflects the whole pile + both JDs
    vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True,
                          stop_words="english", token_pattern=r"(?u)\b[\w+#.\-]{2,}\b")
    vec.fit(cand_docs + jd_docs)
    names = vec.get_feature_names_out()
    C = vec.transform(cand_docs)
    J = vec.transform(jd_docs)
    sim = cosine_similarity(C, J)  # [n_candidates, n_jds]

    role_ids = [j["role_id"] for j in jds]
    results = []
    for i, c in enumerate(candidates):
        per_role = {}
        for k, jd in enumerate(jds):
            hits, misses = keyword_hits(cand_docs[i], jd)
            per_role[jd["role_id"]] = {
                "tfidf_score": round(float(sim[i, k]), 4),
                "keyword_hits": hits,
                "keyword_missing": misses,
                "keyword_coverage": round(len(hits) / max(1, len(jd.get("keywords", []))), 3),
                "top_matching_terms": top_terms(C[i], J[k], names),
                "experience_check": experience_check(c.get("years_of_experience"), jd),
                "projects_ok": (c.get("projects_count") or 0) >= (jd.get("min_projects") or 0),
            }
        label, reason = classify({r: per_role[r]["tfidf_score"] for r in role_ids})
        results.append({
            "candidate_name": c.get("candidate_name", f"candidate_{i}"),
            "llm_assigned_role": c.get("assigned_role"),
            "years_of_experience": c.get("years_of_experience"),
            "projects_count": c.get("projects_count"),
            "classification": label,
            "classification_reason": reason,
            "agrees_with_llm_label": (label == c.get("assigned_role")) if label in role_ids else None,
            "scores": per_role,
        })

    # per-role ranks (1 = best)
    for r in role_ids:
        order = sorted(range(len(results)), key=lambda i: results[i]["scores"][r]["tfidf_score"], reverse=True)
        for rank, i in enumerate(order, 1):
            results[i]["scores"][r]["rank"] = rank
    return results, role_ids


def write_outputs(results, role_ids, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "scores.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    # flat csv
    cols = ["candidate_name", "llm_assigned_role", "classification", "years_of_experience", "projects_count"]
    for r in role_ids:
        cols += [f"{r}_score", f"{r}_rank", f"{r}_kw_coverage"]
    with open(os.path.join(out_dir, "scores.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for x in results:
            row = [x["candidate_name"], x["llm_assigned_role"], x["classification"],
                   x["years_of_experience"], x["projects_count"]]
            for r in role_ids:
                s = x["scores"][r]
                row += [s["tfidf_score"], s["rank"], s["keyword_coverage"]]
            w.writerow(row)

    # one ranked csv per role
    for r in role_ids:
        ranked = sorted(results, key=lambda x: x["scores"][r]["rank"])
        with open(os.path.join(out_dir, f"ranking_{r}.csv"), "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["rank", "candidate_name", "score", "keyword_hits", "experience_check", "classification"])
            for x in ranked:
                s = x["scores"][r]
                w.writerow([s["rank"], x["candidate_name"], s["tfidf_score"],
                            "; ".join(s["keyword_hits"]), s["experience_check"], x["classification"]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--jds", nargs="+", required=True, help="one JSON file per role")
    ap.add_argument("--out", default="results")
    a = ap.parse_args()

    candidates = load_candidates(a.candidates)
    jds = [load_json(p) for p in a.jds]
    results, role_ids = score(candidates, jds)
    write_outputs(results, role_ids, a.out)

    print(f"Scored {len(results)} candidates against {role_ids}. Wrote files to ./{a.out}/")
    for r in role_ids:
        print(f"\nTop 5 for {r}:")
        for x in sorted(results, key=lambda x: x["scores"][r]["rank"])[:5]:
            print(f"  #{x['scores'][r]['rank']} {x['candidate_name']}  {x['scores'][r]['tfidf_score']}")


if __name__ == "__main__":
    main()