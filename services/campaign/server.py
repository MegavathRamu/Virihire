"""Campaign Service — Python gRPC server.

Recruiter selects candidates -> CreateCampaign -> emails are sent ASYNC so the
request returns immediately. Status is tracked per recipient in campaigndb.

Async transport: an in-process queue + worker thread (runs locally without
Docker). This is the *swap point* for Kafka + Celery — replace `JOBS.put(id)`
with a Kafka produce and the worker loop with a Celery task; everything else
(email log, status) stays the same.
"""
import os
import sys
import time
import queue
import threading
from concurrent import futures

import grpc
from pymongo import MongoClient
from bson import ObjectId

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "gen"))
import campaign_pb2          # noqa: E402
import campaign_pb2_grpc     # noqa: E402
import auth_pb2              # noqa: E402
import auth_pb2_grpc         # noqa: E402

from emailer import send_email, compose_email  # noqa: E402

PORT = os.environ.get("PORT", "50055")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017/campaigndb")
AUTH_SERVICE_URL = os.environ.get("AUTH_SERVICE_URL", "localhost:50051")

# --- Mongo (with retry) ---
def connect_db():
    for attempt in range(1, 31):
        try:
            client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=2000)
            client.admin.command("ping")
            db = client.get_default_database()
            if db is None:
                db = client["campaigndb"]
            print(f"[campaign] connected to mongo: {MONGO_URL}", flush=True)
            return db
        except Exception as e:  # noqa: BLE001
            print(f"[campaign] mongo connect failed (attempt {attempt}): {e}", flush=True)
            time.sleep(2)
    raise RuntimeError("could not connect to mongo")

db = connect_db()
campaigns = db["campaigns"]

# --- Auth client (to resolve candidate emails) ---
_auth_channel = grpc.insecure_channel(AUTH_SERVICE_URL)
_auth_stub = auth_pb2_grpc.AuthServiceStub(_auth_channel)

# --- Async job queue (Kafka/Celery swap point) ---
JOBS: "queue.Queue[str]" = queue.Queue()


def resolve_recipients(candidate_ids):
    resp = _auth_stub.GetUsers(auth_pb2.UserIdsReq(userIds=candidate_ids))
    by_id = {u.userId: u for u in resp.users}
    recipients = []
    for cid in candidate_ids:
        u = by_id.get(cid)
        if u and u.email:
            recipients.append({"candidateId": cid, "name": u.name, "email": u.email, "status": "queued", "error": ""})
        else:
            recipients.append({"candidateId": cid, "name": u.name if u else "", "email": "", "status": "failed", "error": "no email on file"})
    return recipients


def process_campaign(campaign_id: str):
    doc = campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not doc:
        return
    campaigns.update_one({"_id": doc["_id"]}, {"$set": {"status": "sending"}})
    sent = failed = 0
    recipients = doc["recipients"]
    for i, r in enumerate(recipients):
        if r["status"] == "failed":  # unresolved email
            failed += 1
            continue
        text, html = compose_email(r.get("name", ""), doc["message"], doc.get("company", ""), doc.get("role", ""))
        ok, err = send_email(r["email"], doc["subject"], text, html, doc.get("company", ""), doc.get("replyTo", ""))
        recipients[i]["status"] = "sent" if ok else "failed"
        recipients[i]["error"] = "" if ok else err
        sent += 1 if ok else 0
        failed += 0 if ok else 1
        campaigns.update_one(
            {"_id": doc["_id"]},
            {"$set": {"recipients": recipients, "sent": sent, "failed": failed}},
        )
    campaigns.update_one({"_id": doc["_id"]}, {"$set": {"status": "done", "sent": sent, "failed": failed}})
    print(f"[campaign] {campaign_id} done: {sent} sent, {failed} failed", flush=True)


def worker():
    while True:
        cid = JOBS.get()
        try:
            process_campaign(cid)
        except Exception as e:  # noqa: BLE001
            print(f"[campaign] worker error on {cid}: {e}", flush=True)
        finally:
            JOBS.task_done()


def to_pb(doc) -> "campaign_pb2.Campaign":
    return campaign_pb2.Campaign(
        id=str(doc["_id"]),
        subject=doc.get("subject", ""),
        message=doc.get("message", ""),
        status=doc.get("status", ""),
        recipients=[
            campaign_pb2.Recipient(
                candidateId=r.get("candidateId", ""),
                name=r.get("name", ""),
                email=r.get("email", ""),
                status=r.get("status", ""),
                error=r.get("error", ""),
            )
            for r in doc.get("recipients", [])
        ],
        total=len(doc.get("recipients", [])),
        sent=doc.get("sent", 0),
        failed=doc.get("failed", 0),
        createdAt=doc.get("createdAt", ""),
    )


class CampaignServicer(campaign_pb2_grpc.CampaignServiceServicer):
    def CreateCampaign(self, request, context):
        ids = list(request.candidateIds)
        if not ids:
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("no candidates selected")
            return campaign_pb2.Campaign()
        if not request.subject or not request.message:
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("subject and message are required")
            return campaign_pb2.Campaign()

        try:
            recipients = resolve_recipients(ids)
        except Exception as e:  # noqa: BLE001
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"failed to resolve recipients: {e}")
            return campaign_pb2.Campaign()

        doc = {
            "recruiterId": request.recruiterId,
            "subject": request.subject,
            "message": request.message,
            "company": request.company,
            "role": request.role,
            "replyTo": request.replyTo,
            "status": "queued",
            "recipients": recipients,
            "sent": 0,
            "failed": sum(1 for r in recipients if r["status"] == "failed"),
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        res = campaigns.insert_one(doc)
        doc["_id"] = res.inserted_id
        JOBS.put(str(res.inserted_id))  # <-- swap for Kafka produce
        return to_pb(doc)

    def GetCampaign(self, request, context):
        try:
            doc = campaigns.find_one({"_id": ObjectId(request.id)})
        except Exception:  # noqa: BLE001
            doc = None
        if not doc:
            context.set_code(grpc.StatusCode.NOT_FOUND)
            context.set_details("campaign not found")
            return campaign_pb2.Campaign()
        return to_pb(doc)


def serve():
    threading.Thread(target=worker, daemon=True).start()
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    campaign_pb2_grpc.add_CampaignServiceServicer_to_server(CampaignServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{PORT}")
    server.start()
    print(f"[campaign] gRPC server listening on :{PORT} (provider: {os.environ.get('EMAIL_PROVIDER', 'sandbox')})", flush=True)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
