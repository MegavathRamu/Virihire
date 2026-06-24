"""Verify Engine — Python gRPC server (we are the OCR/verification provider).

Sequential, gated verification with the Aadhaar-anchor fraud rule:
  identity (name + father) -> aadhaar_front -> aadhaar_back -> pan -> tenth -> twelfth -> employment
Each step is locked until the previous is complete. Names on every document are
fuzzy-matched against the Aadhaar name; 3 mismatches -> flagged (let through).
Extracted fields + images are stored in verifydb.
"""
import os
import sys
import time
import threading
from concurrent import futures

import grpc
from pymongo import MongoClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "gen"))
import verify_pb2          # noqa: E402
import verify_pb2_grpc     # noqa: E402

import ocr                 # noqa: E402

PORT = os.environ.get("PORT", "50057")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017/verifydb")
NAME_THRESHOLD = float(os.environ.get("NAME_THRESHOLD", "0.7"))
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "3"))

# The fixed verification order.
SEQUENCE = ["aadhaar_front", "aadhaar_back", "pan", "tenth", "twelfth", "employment"]
NAME_CHECK = {"pan", "tenth", "twelfth", "employment"}  # matched vs Aadhaar anchor


def connect_db():
    for attempt in range(1, 31):
        try:
            client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=2000)
            client.admin.command("ping")
            db = client.get_default_database()
            if db is None:
                db = client["verifydb"]
            print(f"[verify] connected to mongo: {MONGO_URL}", flush=True)
            return db
        except Exception as e:  # noqa: BLE001
            print(f"[verify] mongo connect failed (attempt {attempt}): {e}", flush=True)
            time.sleep(2)
    raise RuntimeError("could not connect to mongo")


db = connect_db()
candidates = db["candidates"]   # one verification record per candidate
images = db["images"]           # base64 images keyed by (candidateId, docType)


def blank_state(candidate_id):
    return {
        "_id": candidate_id,
        "name": "",
        "fatherName": "",
        "anchorName": "",
        "aadhaarVerified": False,
        "docs": {},  # docType -> {status, extractedName, extractedNumber, attempts}
    }


def get_state(candidate_id):
    return candidates.find_one({"_id": candidate_id}) or blank_state(candidate_id)


def is_complete(doc):
    return doc and doc.get("status") in ("verified", "flagged")


def next_step(state):
    if not state.get("name"):
        return "identity"
    for dt in SEQUENCE:
        if not is_complete(state["docs"].get(dt)):
            return dt
    return "done"


def to_state_pb(state):
    docs = [
        verify_pb2.DocState(
            docType=dt,
            status=(state["docs"].get(dt) or {}).get("status", "pending"),
            extractedName=(state["docs"].get(dt) or {}).get("extractedName", ""),
            extractedNumber=(state["docs"].get(dt) or {}).get("extractedNumber", ""),
            attempts=(state["docs"].get(dt) or {}).get("attempts", 0),
        )
        for dt in SEQUENCE
    ]
    return verify_pb2.VerifyState(
        candidateId=state["_id"],
        name=state.get("name", ""),
        fatherName=state.get("fatherName", ""),
        anchorName=state.get("anchorName", ""),
        aadhaarVerified=state.get("aadhaarVerified", False),
        docs=docs,
        nextStep=next_step(state),
    )


class VerifyServicer(verify_pb2_grpc.VerifyEngineServicer):
    def SetIdentity(self, request, context):
        state = get_state(request.candidateId)
        state["name"] = request.name.strip()
        state["fatherName"] = request.fatherName.strip()
        candidates.replace_one({"_id": request.candidateId}, state, upsert=True)
        return to_state_pb(state)

    def GetState(self, request, context):
        return to_state_pb(get_state(request.candidateId))

    def VerifyDocument(self, request, context):
        dt = request.docType
        if dt not in SEQUENCE:
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details(f"unknown docType {dt}")
            return verify_pb2.VerifyResult()

        state = get_state(request.candidateId)
        if not state.get("name"):
            context.set_code(grpc.StatusCode.FAILED_PRECONDITION)
            context.set_details("enter name and father's name first")
            return verify_pb2.VerifyResult()

        # Enforce order: every earlier step must be complete.
        for earlier in SEQUENCE[: SEQUENCE.index(dt)]:
            if not is_complete(state["docs"].get(earlier)):
                context.set_code(grpc.StatusCode.FAILED_PRECONDITION)
                context.set_details(f"complete '{earlier}' before '{dt}'")
                return verify_pb2.VerifyResult()

        # --- OCR ---
        try:
            lines = ocr.ocr_lines(request.imageBase64)
            extracted_name, number = ocr.extract_fields(dt, lines)
        except Exception as e:  # noqa: BLE001
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"OCR failed: {e}")
            return verify_pb2.VerifyResult()

        # store the image
        images.replace_one(
            {"candidateId": request.candidateId, "docType": dt},
            {"candidateId": request.candidateId, "docType": dt, "imageBase64": request.imageBase64},
            upsert=True,
        )

        prev = state["docs"].get(dt, {})
        attempts = prev.get("attempts", 0)

        # aadhaar_back carries the address, not a name — just store it.
        if dt == "aadhaar_back":
            state["docs"][dt] = {"status": "verified", "extractedName": extracted_name, "extractedNumber": number, "attempts": attempts}
            state["aadhaarVerified"] = is_complete(state["docs"].get("aadhaar_front")) and is_complete(state["docs"].get("aadhaar_back"))
            self._save(state)
            return self._result(dt, "verified", extracted_name, number, state.get("anchorName", ""), 1.0, MAX_ATTEMPTS - attempts, "captured")

        # Which name do we compare against?
        #   aadhaar_front: extracted Aadhaar name vs the ENTERED name (first fraud gate)
        #   others:        extracted name vs the Aadhaar anchor name
        target = state["name"] if dt == "aadhaar_front" else state.get("anchorName", "")
        score = ocr.name_similarity(extracted_name, target)

        if score >= NAME_THRESHOLD:
            state["docs"][dt] = {"status": "verified", "extractedName": extracted_name, "extractedNumber": number, "attempts": attempts}
            if dt == "aadhaar_front":
                state["anchorName"] = extracted_name  # Aadhaar becomes the anchor
            if dt in ("aadhaar_front", "aadhaar_back"):
                fr = state["docs"].get("aadhaar_front")
                bk = state["docs"].get("aadhaar_back")
                state["aadhaarVerified"] = is_complete(fr) and is_complete(bk)
            self._save(state)
            return self._result(dt, "verified", extracted_name, number, state.get("anchorName", target), score, MAX_ATTEMPTS - attempts, "verified")

        # mismatch
        attempts += 1
        left = MAX_ATTEMPTS - attempts
        if attempts >= MAX_ATTEMPTS:
            state["docs"][dt] = {"status": "flagged", "extractedName": extracted_name, "extractedNumber": number, "attempts": attempts}
            if dt == "aadhaar_front":
                state["anchorName"] = extracted_name or state["name"]
            self._save(state)
            return self._result(dt, "flagged", extracted_name, number, target, score, 0,
                                "Name mismatch after 3 attempts — submitted for manual review.")
        state["docs"][dt] = {"status": "mismatch", "extractedName": extracted_name, "extractedNumber": number, "attempts": attempts}
        self._save(state)
        return self._result(dt, "mismatch", extracted_name, number, target, score, left,
                            f"Name on document ('{extracted_name}') does not match '{target}'. {left} attempt(s) left.")

    def _save(self, state):
        candidates.replace_one({"_id": state["_id"]}, state, upsert=True)

    def _result(self, dt, status, name, number, anchor, score, left, msg):
        return verify_pb2.VerifyResult(
            docType=dt, status=status, extractedName=name, extractedNumber=number,
            anchorName=anchor, nameScore=score, attemptsLeft=left, message=msg,
        )


def serve():
    # Document images can be several MB — raise gRPC's 4MB default.
    opts = [
        ("grpc.max_receive_message_length", 25 * 1024 * 1024),
        ("grpc.max_send_message_length", 25 * 1024 * 1024),
    ]
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8), options=opts)
    verify_pb2_grpc.add_VerifyEngineServicer_to_server(VerifyServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{PORT}")
    server.start()
    print(f"[verify] gRPC server listening on :{PORT}", flush=True)
    # Warm up EasyOCR (loads models) in the background so the first request is fast.
    threading.Thread(target=lambda: ocr.get_reader(), daemon=True).start()
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
