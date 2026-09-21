"""Notification Service — Python gRPC server.

The "Lambda" that reacts to a new job (job.created):
  1. rank candidates for the role (Search Service)  <-- swap in your model here
  2. keep strong matches (score >= MIN_SCORE)
  3. resolve phone (Profile Service) + name (Auth Service)
  4. send SMS (sandbox/Twilio), deduped per (jobId, candidateId)

Async transport: in-process queue + worker thread (the Kafka/Celery/Lambda
swap point). RecommendForJob returns immediately; work happens in the worker.
"""
import os
import sys
import time
import queue
import threading
from concurrent import futures

import grpc
from pymongo import MongoClient, ASCENDING

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "gen"))
import notify_pb2          # noqa: E402
import notify_pb2_grpc     # noqa: E402
import profile_pb2         # noqa: E402
import profile_pb2_grpc    # noqa: E402
import auth_pb2            # noqa: E402
import auth_pb2_grpc       # noqa: E402
import job_pb2             # noqa: E402
import job_pb2_grpc        # noqa: E402

from sms import send_sms   # noqa: E402
import mailer              # noqa: E402
import recommender         # noqa: E402  (content-based engine — separate from semantic search)

PORT = os.environ.get("PORT", "50056")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017/notifydb")
PROFILE_SERVICE_URL = os.environ.get("PROFILE_SERVICE_URL", "localhost:50052")
AUTH_SERVICE_URL = os.environ.get("AUTH_SERVICE_URL", "localhost:50051")
JOB_SERVICE_URL = os.environ.get("JOB_SERVICE_URL", "localhost:50053")
MIN_SCORE = float(os.environ.get("MIN_SCORE", "0.05"))   # only notify real matches
# How often the recommendation engine runs on its own (cron-style). Default 10 min.
RUN_INTERVAL = int(os.environ.get("RECOMMEND_INTERVAL_SECONDS", "600"))


def connect_db():
    for attempt in range(1, 31):
        try:
            client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=2000)
            client.admin.command("ping")
            db = client.get_default_database()
            if db is None:
                db = client["notifydb"]
            print(f"[notify] connected to mongo: {MONGO_URL}", flush=True)
            return db
        except Exception as e:  # noqa: BLE001
            print(f"[notify] mongo connect failed (attempt {attempt}): {e}", flush=True)
            time.sleep(2)
    raise RuntimeError("could not connect to mongo")


db = connect_db()
notifications = db["notifications"]
# Dedup: one notification per candidate per job.
notifications.create_index([("jobId", ASCENDING), ("candidateId", ASCENDING)], unique=True)

_profile = profile_pb2_grpc.ProfileServiceStub(grpc.insecure_channel(PROFILE_SERVICE_URL))
_auth = auth_pb2_grpc.AuthServiceStub(grpc.insecure_channel(AUTH_SERVICE_URL))
_job = job_pb2_grpc.JobServiceStub(grpc.insecure_channel(JOB_SERVICE_URL))

JOBS: "queue.Queue[dict]" = queue.Queue()


def profile_text(p) -> str:
    parts = []
    if p.skills:
        parts.append("Skills: " + ", ".join(p.skills))
    edu = [" ".join(x for x in [e.degree, e.school, e.year] if x).strip() for e in p.education]
    edu = [e for e in edu if e]
    if edu:
        parts.append("Education: " + "; ".join(edu))
    exp = [(f"{x.title} at {x.company}").strip() for x in p.experience if (x.title or x.company)]
    if exp:
        parts.append("Experience: " + "; ".join(exp))
    parts.append("Experienced professional" if p.hasExperience else "Fresher")
    return ". ".join(parts)


def rank_candidates(job: dict):
    """Content-based recommendation. Pulls the candidate pool from the Profile
    Service and scores with the TF-IDF + skill-overlap recommender (NOT the
    semantic search engine). Returns (ranked[(id, score)], profiles_by_id)."""
    resp = _profile.ListProfiles(profile_pb2.ListProfilesReq(limit=0))
    profiles_by_id = {p.userId: p for p in resp.profiles}
    candidates = [
        {"candidateId": p.userId, "text": profile_text(p), "skills": list(p.skills)}
        for p in resp.profiles
    ]
    ranked = [(cid, s) for cid, s in recommender.rank(job, candidates) if s >= MIN_SCORE]
    return ranked, profiles_by_id


def candidate_users(ids):
    try:
        resp = _auth.GetUsers(auth_pb2.UserIdsReq(userIds=ids))
        return {u.userId: (u.name, u.email) for u in resp.users}
    except grpc.RpcError:
        return {}


def process_job(job: dict):
    matches, profiles = rank_candidates(job)
    if not matches:
        print(f"[notify] job {job['jobId']}: no matching candidates", flush=True)
        return
    users = candidate_users([cid for cid, _ in matches])
    company = job.get("company", "")
    subject = f"You're a match: {job.get('title','a role')} at {company}"
    for cid, score in matches:
        # Dedup: skip if we already notified this candidate for this job.
        if notifications.find_one({"jobId": job["jobId"], "candidateId": cid}):
            continue
        name, email = users.get(cid, ("", ""))
        p = profiles.get(cid)
        phone = (p.phone if p else "") or ""

        # 1) Auto-EMAIL the matching candidate (job details + please-apply), from the company.
        email_status, email_err = "skipped", "no email on file"
        if email:
            text, html = mailer.compose_job_alert(name, job)
            ok, err = mailer.send_email(email, subject, text, html, company, job.get("recruiterEmail", ""))
            email_status, email_err = ("sent" if ok else "failed"), ("" if ok else err)

        # 2) Auto-SMS as well (if a phone is on file).
        sms_status, sms_err = "skipped", "no phone on file"
        if phone:
            sms_text = f"Hi {name or 'there'}, a new role '{job.get('title','')}' at {company} matches your skills. Apply on Verihire."
            ok, err = send_sms(phone, sms_text)
            sms_status, sms_err = ("sent" if ok else "failed"), ("" if ok else err)

        rec = {
            "jobId": job["jobId"], "candidateId": cid, "name": name, "email": email, "phone": phone,
            "score": float(score),
            "channel": "email+sms",
            "status": email_status,          # primary channel = email
            "error": email_err if email_status != "sent" else "",
            "smsStatus": sms_status, "smsError": sms_err,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        try:
            notifications.insert_one(rec)
        except Exception:  # noqa: BLE001 (duplicate key from a race — ignore)
            pass
    print(f"[notify] job {job['jobId']}: emailed/sms'd {len(matches)} matches", flush=True)


def worker():
    while True:
        job = JOBS.get()
        try:
            process_job(job)
        except Exception as e:  # noqa: BLE001
            print(f"[notify] worker error: {e}", flush=True)
        finally:
            JOBS.task_done()


def recruiter_email(recruiter_id: str) -> str:
    try:
        resp = _auth.GetUsers(auth_pb2.UserIdsReq(userIds=[recruiter_id]))
        return resp.users[0].email if resp.users else ""
    except grpc.RpcError:
        return ""


def sweep_all_jobs():
    """One scheduled pass: match candidates to every job and email new matches.
    Dedup (jobId+candidateId) means each pass only notifies people not yet notified —
    so it also catches candidates who signed up after a job was posted."""
    resp = _job.ListJobs(job_pb2.SearchReq(keyword=""))
    jobs = list(resp.jobs)
    print(f"[notify] scheduled run: scanning {len(jobs)} job(s)", flush=True)
    for j in jobs:
        process_job({
            "jobId": j.id,
            "title": j.title,
            "company": j.company,
            "skills": list(j.skills),
            "description": j.description,
            "location": j.location,
            "recruiterEmail": recruiter_email(j.recruiterId),
        })


def scheduler():
    """Runs the recommendation engine on its own every RUN_INTERVAL seconds — no trigger."""
    while True:
        try:
            sweep_all_jobs()
        except Exception as e:  # noqa: BLE001
            print(f"[notify] scheduled run failed: {e}", flush=True)
        time.sleep(RUN_INTERVAL)


class NotifyServicer(notify_pb2_grpc.NotificationServiceServicer):
    def RecommendForJob(self, request, context):
        JOBS.put(
            {
                "jobId": request.jobId,
                "title": request.title,
                "company": request.company,
                "skills": list(request.skills),
                "description": request.description,
            }
        )
        return notify_pb2.Ack(accepted=True)

    def GetJobNotifications(self, request, context):
        docs = notifications.find({"jobId": request.jobId}).sort("score", -1)
        items = [
            notify_pb2.Notification(
                candidateId=d.get("candidateId", ""),
                name=d.get("name", ""),
                phone=d.get("phone", ""),
                score=d.get("score", 0.0),
                status=d.get("status", ""),
                channel=d.get("channel", "sms"),
                error=d.get("error", ""),
            )
            for d in docs
        ]
        return notify_pb2.NotificationList(notifications=items)


def serve():
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=scheduler, daemon=True).start()  # cron-style auto-runner
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    notify_pb2_grpc.add_NotificationServiceServicer_to_server(NotifyServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{PORT}")
    server.start()
    print(f"[notify] gRPC server listening on :{PORT} — recommendation engine runs every {RUN_INTERVAL}s "
          f"(email: {os.environ.get('EMAIL_PROVIDER','sandbox')}, sms: {os.environ.get('SMS_PROVIDER','sandbox')})", flush=True)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
