"""Search Service — Python gRPC server.

Realtime NL -> candidate match:
  * builds a FAISS index from ProfileService.ListProfiles (over gRPC),
  * embeds the recruiter's query and returns the top-K candidates.

Database-per-service: it never touches profiledb directly — it pulls profiles
from the Profile Service.
"""
import os
import sys
import time
import threading
from concurrent import futures

import grpc

# Generated stubs live in ./gen (see gen_proto.sh / Dockerfile).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "gen"))
import search_pb2          # noqa: E402
import search_pb2_grpc     # noqa: E402
import profile_pb2         # noqa: E402
import profile_pb2_grpc    # noqa: E402

from candidate_index import CandidateIndex  # noqa: E402
from embeddings import using_voyage          # noqa: E402

PORT = os.environ.get("PORT", "50054")
PROFILE_SERVICE_URL = os.environ.get("PROFILE_SERVICE_URL", "localhost:50052")
DEFAULT_TOP_K = 10

index = CandidateIndex()
_profile_channel = grpc.insecure_channel(PROFILE_SERVICE_URL)
_profile_stub = profile_pb2_grpc.ProfileServiceStub(_profile_channel)


def profile_summary(p) -> str:
    """Build the text we embed for a candidate."""
    parts = []
    if p.skills:
        parts.append("Skills: " + ", ".join(p.skills))
    edu = [" ".join(x for x in [e.degree, e.school, e.year] if x).strip() for e in p.education]
    edu = [e for e in edu if e]
    if edu:
        parts.append("Education: " + "; ".join(edu))
    exp = [
        (f"{x.title} at {x.company} ({x.years})").strip()
        for x in p.experience
        if (x.title or x.company)
    ]
    if exp:
        parts.append("Experience: " + "; ".join(exp))
    parts.append("Experienced professional" if p.hasExperience else "Fresher")
    return ". ".join(parts)


def do_reindex() -> int:
    resp = _profile_stub.ListProfiles(profile_pb2.ListProfilesReq(limit=0))
    candidates = [
        {
            "candidateId": p.userId,
            "summary": profile_summary(p),
            "skills": list(p.skills),
            "hasExperience": p.hasExperience,
        }
        for p in resp.profiles
    ]
    n = index.rebuild(candidates)
    print(f"[search] reindexed {n} candidates", flush=True)
    return n


def initial_reindex():
    # Profile service may not be up yet at boot — retry a few times.
    for attempt in range(1, 31):
        try:
            do_reindex()
            return
        except Exception as e:  # noqa: BLE001
            print(f"[search] initial reindex attempt {attempt} failed: {e}", flush=True)
            time.sleep(2)


class SearchServicer(search_pb2_grpc.SearchServiceServicer):
    def SearchCandidates(self, request, context):
        top_k = request.topK if request.topK and request.topK > 0 else DEFAULT_TOP_K
        query = (request.query or "").strip()
        results = index.search(query, top_k) if query else index.list_all(top_k)
        matches = [
            search_pb2.CandidateMatch(
                candidateId=r["candidateId"],
                score=r["score"],
                summary=r["summary"],
                skills=r["skills"],
            )
            for r in results
        ]
        return search_pb2.CandidateMatches(matches=matches, indexed=index.size())

    def Reindex(self, request, context):
        try:
            n = do_reindex()
            return search_pb2.ReindexRes(indexed=n)
        except Exception as e:  # noqa: BLE001
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return search_pb2.ReindexRes(indexed=0)


def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    search_pb2_grpc.add_SearchServiceServicer_to_server(SearchServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{PORT}")
    server.start()
    backend = "voyage" if using_voyage() else "local-hash"
    print(f"[search] gRPC server listening on :{PORT} (embeddings: {backend})", flush=True)
    threading.Thread(target=initial_reindex, daemon=True).start()
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
