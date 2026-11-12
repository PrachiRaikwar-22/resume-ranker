// Rule-based extraction for uploaded resumes (no API key needed)
import { normalize } from "./score";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function extractFromText(text, fileName, knownSkills) {
  const warnings = [];
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length < 200) warnings.push("Very little text found - file may be a scanned image or unreadable PDF");

  const low = normalize(clean);
  let years = null;
  const ym = [...clean.matchAll(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/gi)].map((m) => parseFloat(m[1])).filter((n) => n <= 40);
  if (ym.length) years = Math.round(Math.max(...ym));
  else warnings.push("No 'N years' statement found - years of experience left empty");

  const skills = [...new Set(knownSkills.map((s) => s.trim()).filter(Boolean))]
    .filter((s) => new RegExp(`(?<![a-z0-9])${esc(normalize(s))}(?![a-z0-9])`).test(low));
  if (!skills.length && clean.length >= 200) warnings.push("No known skills matched");

  const projects = Math.min((clean.match(/\bprojects?\b/gi) || []).length, 10);
  const summary = clean.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 300);

  return {
    candidate_name: fileName.replace(/\.[^.]+$/, ""),
    assigned_role: null,
    years_of_experience: years,
    projects_count: projects,
    skills_found: skills,
    summary,
    is_upload: true,
    warnings,
  };
}
