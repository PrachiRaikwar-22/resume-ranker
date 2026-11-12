# Resume Ranker — Growth For Impact Assignment

A prototype that helps an HR team screen resumes for two roles:

1. **LCA Consultant (Chennai)** — 4–6 years experience
2. **UI/UX Design Intern**

It extracts job-related information from resumes, classifies each resume (LCA / UI/UX / both / uncertain), ranks candidates per role with an explanation, and lets a reviewer upload a new resume and see where it lands in the pile.

**Live demo:** https://resume-ranker-ten.vercel.app/

---

## Features

- Ranked table per role (score, score bar, years of experience, keyword coverage, classification)
- Sort by score / years / keyword coverage / name; search by name or skill; filter by classification; minimum-score filter
- Candidate detail panel: extracted skills, summary, years, projects, matched and missing JD keywords, top matching terms, experience check, classification reason
- Link to the source resume PDF for human verification
- Warnings shown for resumes with missing or unreadable information (e.g. no skills extracted, empty or scanned PDF)
- **Upload a new resume** (PDF or TXT): it is extracted, scored, inserted into the pile, and its rank for each role is shown

---

## Methodology

### 1. Extraction (done once, offline)
Resumes were converted to structured JSON using an LLM with a fixed schema, and the output was then reviewed and corrected by hand against the source resumes:

| Field | Meaning |
|---|---|
| `candidate_name` | Anonymised name / ID |
| `assigned_role` | The LLM's own best-fit guess (kept only for comparison, **not used in scoring**) |
| `years_of_experience` | Total professional experience |
| `projects_count` | Distinct projects / case studies |
| `skills_found` | Tools, software, technical skills |
| `summary` | 2-sentence profile |

Output: `data/all_resumes.json` (47 resumes). One resume was empty/unreadable; it is kept in the pile with a warning instead of being dropped.

### 2. Job descriptions
Each JD is a JSON file (`role_id`, `title`, `must_have_skill`, `nice_to_have_skills`, `keywords`, `min_years`, `max_years`, `min_projects`) in `data/`.

### 3. Ranking method (TF-IDF + cosine similarity)
- **JD document** = title + must-haves + nice-to-haves + keywords (keywords repeated twice so they weigh more).
- **Resume document** = `skills_found` (twice) + `summary`.
- One TF-IDF model is fit on all resumes + both JDs (unigrams + bigrams, common stop words removed, sublinear TF, smoothed IDF, L2-normalised).
- **Score** = cosine similarity between the resume vector and the JD vector, shown as 0 to 100. Candidates are ranked separately for each role.
- Scores are fairly low for most candidates (resumes are short skill lists compared with long JDs), so the ranking order matters more than the absolute number.
- `pipeline/score.py` runs the same method in Python (scikit-learn) and writes CSVs for review. The web app uses the same method in JavaScript, so decimals can differ slightly; the web app's scores are the reference.

### 4. Classification
- `uncertain` — best score below **4**
- `both` — top two scores within **3 points** of each other
- otherwise — the role with the higher score

### 5. Evidence shown for every result
Matched / missing JD keywords, keyword coverage %, top terms contributing to the score, years-of-experience check vs the JD range, and whether the minimum project count is met. Years and project checks are evidence only — they do **not** change the score.

### 6. Uploaded resumes
PDF text is read with `unpdf`, then simple rules extract fields (no external API key needed):
- years of experience: largest "N years / yrs" mention
- skills: matched against skills seen in the pile + JD keywords
- projects: count of the word "project(s)" (max 10)
- summary: first two sentences

The new resume is added to the pile, everyone is re-scored, and its rank is returned. Uploads are not saved (they disappear on refresh).

---

## Limitations

- Not every resume extracts perfectly; scanned/image PDFs have no text and will show warnings.
- TF-IDF measures keyword/term overlap, not real understanding — a resume using different wording for the same skill can score lower.
- Rule-based extraction for uploads is weaker than the LLM extraction used for the main pile.
- Experience and project counts are shown as evidence but are not part of the score.
- Thresholds (4 and 3 points) were set after inspecting the score distribution and can be tuned in `lib/score.js`.
- This tool supports human review; it should not make hiring decisions on its own.

---

## Project structure

```
resume-ranker/
├── app/
│   ├── page.js              # UI (tabs, table, filters, detail panel, upload)
│   ├── layout.js, globals.css
│   └── api/
│       ├── results/route.js # GET  scored pile
│       └── upload/route.js  # POST upload a resume and rank it
├── lib/
│   ├── score.js             # TF-IDF, cosine, classification, evidence
│   ├── extract.js           # rule-based extraction for uploads
│   └── data.js              # loads the JSON data
├── data/
│   ├── all_resumes.json
│   ├── jd1_lca.json
│   └── jd2_uiux.json
├── public/resumes/          # source PDFs named <candidate_name>.pdf
├── pipeline/score.py        # offline Python scoring (CSV outputs for review)
└── package.json
```

---

## Run locally

Requires Node.js 18+.

```bash
npm install
npm run dev
```
Open http://localhost:3000

## Updating the data

Edit the files in `data/` (and add PDFs to `public/resumes/`), then push to GitHub. Data is bundled at build time, so changes need a new deploy.

## Deployment

Deployed on Vercel from this GitHub repository. No environment variables are needed.
