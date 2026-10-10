from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DECISION_API = os.environ.get("DECISION_API", "http://127.0.0.1:8790")
MODEL = "Laya · typed-decisions"
ACTIONS = {
    "SCOUT": "Split rifle and shotgun teams across unexplored rooms; MG and snipers follow as cover. Best when mother is hidden and contact danger is low.",
    "SUPPRESS": "Stop forward exploration and focus every weapon on one visible enemy, using ranged firing positions. Choose only for immediate contact danger or route-blocking enemies, not distant enemies.",
    "FLANK": "MG and snipers pin the marked enemy; rifles and shotguns route around its two sides. Choose when several visible enemies block a direct advance and squad strength permits splitting.",
    "ASSAULT": "Rifles and shotguns prioritize firing at the located mother; MG and snipers clear guards. Choose after discovery unless severe close threats or low ammo prevent assault.",
    "REGROUP": "All units retreat to a safe supply point, refill low ammo, and cover each other. Choose for widespread ammo shortage, scattering or severe contact danger.",
    "DEFEND": "Distribute the squad around the seed vault, holding independent sectors. Best in defense with light pressure; suppress or flank when local pressure grows.",
}


def decision_question(state):
    mission = state.get("mission", "protect")
    base = ["ASSAULT" if state.get("mother_core_visible") else "SCOUT"] if mission == "destroy" else ["DEFEND"]
    # Rebuild legal choices on the server as well as the client.
    visible = max(0, state.get("visible_zombies", 0))
    stale = (state.get("last_posture") in {"SUPPRESS", "FLANK"}
             and state.get("seconds_in_current_action", 0) >= 10
             and state.get("kills_in_current_action", 0) == 0
             and state.get("squad_moved_in_current_action", 0) < 15
             and not state.get("squad_in_contact_danger"))
    if (state.get("immediate_zombie_count", 0) or state.get("squad_in_contact_danger", 0)) and not stale:
        base.append("SUPPRESS")
    if visible >= 3 and state.get("survivors", 0) >= 6 and not stale:
        base.append("FLANK")
    survivors = max(1, state.get("survivors", 0))
    if (state.get("squad_low_ammo", 0) >= max(2, (survivors + 3) // 4)
            or state.get("squad_scattered", 0) >= max(4, (survivors + 3) // 4)
            or state.get("squad_in_contact_danger", 0) >= max(3, (survivors * 3 + 9) // 10)):
        base.append("REGROUP")
    return {
        "instructions": "Choose one concrete executable squad order for the next 6 seconds. Use observed enemies only. Advance mission progress when safe. Suppression stops exploration, so require urgent close threats. Do not pick an action merely to vary choices. No progress during suppression suggests switching plans.",
        "criteria": {action: ACTIONS[action] for action in base},
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/api/status":
            try:
                with urllib.request.urlopen(f"{DECISION_API}/health", timeout=2):
                    pass
                self.reply({"service": "Laya", "model": MODEL, "model_available": True})
            except Exception as exc:
                self.reply({"service": "Laya", "model": MODEL, "model_available": False, "error": str(exc)})
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/decision":
            self.send_error(404)
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 16000)
            state = json.loads(self.rfile.read(length) or b"{}")
            mission = state.get("mission", "protect")
            question = decision_question(state)
            body = json.dumps({
                "model": "typed-decisions",
                "state": state,
                "questions": {"posture": {"type": "choice", **question}},
            }).encode()
            req = urllib.request.Request(f"{DECISION_API}/v1/systemone", data=body, headers={"Content-Type": "application/json"})
            started = time.perf_counter()
            with urllib.request.urlopen(req, timeout=8) as r:
                raw = json.load(r)
            latency_ms = (time.perf_counter() - started) * 1000
            answer = raw.get("answers", {}).get("posture", {})
            posture = answer.get("choice")
            if posture not in question["criteria"]:
                raise ValueError("Laya returned a posture outside the allowed options")
            reasons = {action: f"Laya 选择执行：{label}。" for action, label in {
                "SCOUT": "分队搜索", "SUPPRESS": "定点压制", "FLANK": "侧翼包抄",
                "ASSAULT": "突击母体", "REGROUP": "集合补给", "DEFEND": "环形守卫",
            }.items()}
            self.reply({
                "posture": posture,
                "reason": reasons[posture],
                "probabilities": answer.get("probabilities", {}),
                "confidence": answer.get("confidence"),
                "candidates": list(question["criteria"]),
                "latency_ms": round(latency_ms, 1),
                "model": raw.get("routing", {}).get("repo", MODEL),
            })
        except urllib.error.URLError as exc:
            self.reply({"error": "Laya decision service is not available", "detail": str(exc)}, 503)
        except Exception as exc:
            self.reply({"error": "Decision request failed", "detail": str(exc)}, 500)

    def reply(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"Last House listening on http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
