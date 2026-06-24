"use client";
import { useRouter } from "next/navigation";
import type { AuthRes } from "@/lib/api";

export default function Header({ session, onLogout }: { session: AuthRes | null; onLogout: () => void }) {
  const router = useRouter();
  return (
    <div className="header">
      <span className="brand" style={{ cursor: "pointer" }} onClick={() => router.push("/")}>
        veri<span style={{ color: "#f5a623" }}>hire</span>
      </span>
      {session ? (
        <span className="row" style={{ alignItems: "center" }}>
          <span className="muted">
            {session.name} · <b>{session.role}</b>
          </span>
          <button className="ghost" onClick={onLogout}>
            Log out
          </button>
        </span>
      ) : null}
    </div>
  );
}
