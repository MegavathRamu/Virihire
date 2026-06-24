"""Embedding backends for the Search Service.

If VOYAGE_API_KEY is set, uses Voyage AI (same model as the original pipeline).
Otherwise falls back to a deterministic local hashing embedding so the service
runs fully offline for development/demo (no API credits, no network).

All vectors are L2-normalized so a FAISS inner-product index == cosine similarity.
"""
import os
import re
import hashlib
import numpy as np
import requests

VOYAGE_API_KEY = os.environ.get("VOYAGE_API_KEY", "").strip()
VOYAGE_MODEL = os.environ.get("VOYAGE_MODEL", "voyage-3")
VOYAGE_DIM = 1024
LOCAL_DIM = 256


def using_voyage() -> bool:
    return bool(VOYAGE_API_KEY)


def embedding_dim() -> int:
    return VOYAGE_DIM if using_voyage() else LOCAL_DIM


def _tokens(text: str):
    return [t for t in re.split(r"[^a-z0-9+#]+", (text or "").lower()) if len(t) > 1]


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return (v / n) if n > 0 else v


def _local_embed(text: str) -> np.ndarray:
    # Hashing bag-of-words: shared terms (skills, degrees) -> similar vectors.
    vec = np.zeros(LOCAL_DIM, dtype=np.float32)
    for tok in _tokens(text):
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        vec[h % LOCAL_DIM] += 1.0
    return _normalize(vec)


def _voyage_embed(texts):
    headers = {"Authorization": f"Bearer {VOYAGE_API_KEY}", "Content-Type": "application/json"}
    payload = {"model": VOYAGE_MODEL, "input": texts}
    resp = requests.post("https://api.voyageai.com/v1/embeddings", json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()["data"]
    vecs = [np.array(d["embedding"], dtype=np.float32) for d in data]
    return np.vstack([_normalize(v) for v in vecs])


def embed_texts(texts):
    """Return an (n, dim) float32 array of normalized embeddings."""
    if not texts:
        return np.zeros((0, embedding_dim()), dtype=np.float32)
    if using_voyage():
        return _voyage_embed(list(texts)).astype(np.float32)
    return np.vstack([_local_embed(t) for t in texts]).astype(np.float32)
