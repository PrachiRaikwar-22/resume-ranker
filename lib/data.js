import resumes from "../data/all_resumes.json";
import jd1 from "../data/jd1_lca.json";
import jd2 from "../data/jd2_uiux.json";

export const JDS = [jd1, jd2];

export function getCandidates() {
  const list = Array.isArray(resumes) ? resumes : Object.values(resumes).find(Array.isArray) || [];
  return list;
}
