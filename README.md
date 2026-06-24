# Naukri — microservices

Job-board built as true microservices: each service owns its own MongoDB and is
reachable only over gRPC. The API Gateway is the single REST door for the browser.

## Architecture

```
Frontend (Next.js, REST)
        │ REST/JSON
        ▼
   API Gateway  ── verifies JWT, routes, fans out
   │     │     │
 gRPC  gRPC  gRPC
   ▼     ▼     ▼
 Auth  Profile  Job        each its own gRPC server
   ▼     ▼     ▼
authdb profiledb jobdb     separate MongoDB per service
```

## Layout

```
proto/                 frozen gRPC contracts (auth, profile, job)
services/
  gateway/   REST in, gRPC out (port 8080)
  auth/      gRPC, owns authdb       (port 50051)
  profile/   gRPC, owns profiledb    (port 50052)
  job/       gRPC, owns jobdb        (port 50053)
frontend/    Next.js (Day 7)
docker-compose.yml
```

## Run

```bash
docker compose up --build
```

Brings up the gateway + 3 services + 3 MongoDBs. Then:

```bash
curl localhost:8080/health
```

## Database-per-service rule

No service reads another service's DB. Cross-service references (e.g.
`Application.jobId`) are just IDs — the Profile Service calls `JobService.GetJob`
over gRPC when it needs job details.

## Status (Day 1)

Skeleton only. All gRPC handlers return `UNIMPLEMENTED` for now; real logic lands
per the day-by-day plan (Auth Day 2, Gateway routes Day 3, Profile Day 4,
Job Day 5, Apply/Applicants Day 6, Frontend Day 7).
