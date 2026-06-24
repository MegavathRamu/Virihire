"""In-process FAISS index over candidate profile summaries."""
import threading
import numpy as np
import faiss

from embeddings import embedding_dim, embed_texts


class CandidateIndex:
    def __init__(self):
        self.dim = embedding_dim()
        self.index = faiss.IndexFlatIP(self.dim)  # inner product on normalized vecs = cosine
        self.ids = []          # row -> candidateId
        self.meta = {}         # candidateId -> {summary, skills}
        self.lock = threading.Lock()

    def size(self) -> int:
        return len(self.ids)

    def rebuild(self, candidates) -> int:
        """candidates: list of {candidateId, summary, skills[]}."""
        with self.lock:
            self.index = faiss.IndexFlatIP(self.dim)
            self.ids = []
            self.meta = {}
            summaries = [c["summary"] for c in candidates]
            if summaries:
                vecs = embed_texts(summaries)
                self.index.add(vecs)
                for c in candidates:
                    self.ids.append(c["candidateId"])
                    self.meta[c["candidateId"]] = c
            return len(self.ids)

    def list_all(self, top_k: int):
        """No query: return all candidates ranked by profile strength
        (experienced first, then by number of skills)."""
        with self.lock:
            items = list(self.meta.values())
            items.sort(key=lambda c: (1 if c.get("hasExperience") else 0, len(c.get("skills", []))), reverse=True)
            return [
                {"candidateId": c["candidateId"], "score": 0.0, "summary": c.get("summary", ""), "skills": c.get("skills", [])}
                for c in items[:top_k]
            ]

    def search(self, query: str, top_k: int):
        with self.lock:
            if self.size() == 0:
                return []
            qv = embed_texts([query])
            k = min(top_k, self.size())
            scores, idxs = self.index.search(qv, k)
            results = []
            for score, i in zip(scores[0], idxs[0]):
                if i < 0:
                    continue
                cid = self.ids[i]
                m = self.meta.get(cid, {})
                results.append(
                    {
                        "candidateId": cid,
                        "score": float(score),
                        "summary": m.get("summary", ""),
                        "skills": m.get("skills", []),
                    }
                )
            return results
