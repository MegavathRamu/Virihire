"""Content-based recommendation engine.

Separate from the semantic Search engine. Given a job and the candidate pool,
score each candidate by:
    final = (1 - SKILL_BOOST) * TF-IDF_cosine(job_text, candidate_text)
          + SKILL_BOOST       * skill_overlap(job_skills, candidate_skills)

TF-IDF cosine = classic content-based filtering (term-importance weighted).
skill-overlap boost makes exact skill matches rank highest.
"""
import os
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

SKILL_BOOST = float(os.environ.get("SKILL_BOOST", "0.4"))


def job_text(job: dict) -> str:
    return ". ".join(
        filter(None, [job.get("title", ""), " ".join(job.get("skills", [])), job.get("description", "")])
    )


def rank(job: dict, candidates):
    """candidates: list of {candidateId, text, skills}. Returns [(candidateId, score)] desc."""
    if not candidates:
        return []

    docs = [job_text(job)] + [c.get("text", "") for c in candidates]
    sims = np.zeros(len(candidates))
    try:
        tfidf = TfidfVectorizer(stop_words="english").fit_transform(docs)
        if tfidf.shape[1] > 0:
            sims = cosine_similarity(tfidf[0:1], tfidf[1:]).flatten()
    except ValueError:
        # empty vocabulary (e.g. all stopwords) -> rely on skill overlap only
        pass

    job_skills = {s.lower().strip() for s in job.get("skills", []) if s.strip()}
    results = []
    for i, c in enumerate(candidates):
        cand_skills = {s.lower().strip() for s in c.get("skills", []) if s.strip()}
        overlap = (len(job_skills & cand_skills) / len(job_skills)) if job_skills else 0.0
        score = (1 - SKILL_BOOST) * float(sims[i]) + SKILL_BOOST * overlap
        results.append((c["candidateId"], score))

    results.sort(key=lambda x: x[1], reverse=True)
    return results
