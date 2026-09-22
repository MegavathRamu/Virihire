OUTCOMES:
<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/3ea67739-bffb-40d6-b5c5-f5b185b7a4a6" />

<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/aa2b14d1-93a5-4044-9565-1a6eb56b21af" />

<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/8780da75-03f0-48b1-9401-e878476fc62d" />

<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/1acb2a2d-b1b0-4eee-932b-d3c453412e65" />

<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/0f4be378-5253-48ea-8466-9d6f3683034b" />

<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/f6b4721a-4ec4-4049-b9ef-e89658283465" />

<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/c0e56b30-24f4-4c52-ae45-6ec9cdf51c81" />

<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/9cae0032-07b5-499a-a5c0-2e0c20432a2c" />

<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/a4d3eb0f-d325-4a9f-b1e9-91f0b6c8dd6b" />

file:///Users/ramu/Downloads/IDV_Megavath_Ramu.html

<img width="2880" height="1800" alt="image" src="https://github.com/user-attachments/assets/5cc5b889-c2af-42a0-b06f-2246700eecb1" />











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
