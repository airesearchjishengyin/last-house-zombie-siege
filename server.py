from __future__ import annotations

import json
import os
import ipaddress
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
DECISION_API = os.environ.get("DECISION_API", "http://127.0.0.1:8790")
MODEL = "Laya · typed-decisions"
MAX_DECISIONS_PER_MINUTE = 30
request_times = defaultdict(deque)
request_lock = threading.Lock()
model_slots = threading.BoundedSemaphore(2)
ACTION_NAMES = {"SCOUT", "SUPPRESS", "FLANK", "ASSAULT", "REGROUP", "DEFEND"}
MAP_NAMES = {"ridge", "crossroads", "foundry", "labyrinth", "chambers", "river", "custom"}
STATIC_FILES = {"/", "/index.html", "/game.js", "/maps.js", "/style.css"}
COUNT_FIELDS = {
    "wave", "seconds_into_wave", "survivors", "initial_humans", "rooms_searched", "rooms_total",
    "visible_zombies", "zombies_near_house", "immediate_zombie_count", "squad_in_contact_danger",
    "squad_low_ammo", "squad_scattered", "average_distance_to_objective", "seconds_in_current_action",
    "kills_in_current_action", "squad_moved_in_current_action",
}
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


def sanitize_state(raw):
    if not isinstance(raw, dict) or raw.get("mission") not in {"protect", "destroy"}:
        raise ValueError("Invalid game state")
    if raw.get("map") not in MAP_NAMES:
        raise ValueError("Invalid map")
    if raw.get("last_posture") not in ACTION_NAMES:
        raise ValueError("Invalid posture")
    safe = {
        key: raw.get(key, 0)
        for key in COUNT_FIELDS
    }
    for key, value in safe.items():
        if type(value) is not int or not 0 <= value <= 100000:
            raise ValueError(f"Invalid field: {key}")
    safe["mission"] = raw["mission"]
    safe["map"] = raw["map"]
    safe["last_posture"] = raw["last_posture"]
    for key, choices in {
        "ammo_mode": {"infinite", "finite"},
        "mission_stage": {"defend", "search", "eliminate"},
    }.items():
        value = raw.get(key)
        if value not in choices:
            raise ValueError(f"Invalid field: {key}")
        safe[key] = value
    if type(raw.get("mother_core_visible")) is not bool:
        raise ValueError("Invalid field: mother_core_visible")
    safe["mother_core_visible"] = raw["mother_core_visible"]
    integrity = raw.get("objective_integrity")
    if integrity is not None and (type(integrity) is not int or not 0 <= integrity <= 100):
        raise ValueError("Invalid field: objective_integrity")
    safe["objective_integrity"] = integrity
    lanes = raw.get("threat_by_lane", {})
    if not isinstance(lanes, dict) or any(type(lanes.get(key, 0)) is not int or not 0 <= lanes.get(key, 0) <= 1000 for key in ("north", "east", "south", "west")):
        raise ValueError("Invalid field: threat_by_lane")
    safe["threat_by_lane"] = {key: lanes.get(key, 0) for key in ("north", "east", "south", "west")}
    return safe


def allow_decision(ip):
    now = time.monotonic()
    with request_lock:
        bucket = request_times[ip]
        while bucket and now - bucket[0] >= 60:
            bucket.popleft()
        if len(bucket) >= MAX_DECISIONS_PER_MINUTE:
            return False
        bucket.append(now)
        if len(request_times) > 2048:
            for address in tuple(request_times):
                if not request_times[address] or now - request_times[address][-1] >= 600:
                    del request_times[address]
        return True


class Handler(SimpleHTTPRequestHandler):
    timeout = 10

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/status":
            try:
                with urllib.request.urlopen(f"{DECISION_API}/health", timeout=2):
                    pass
                self.reply({"service": "Laya", "model": MODEL, "model_available": True})
            except Exception as exc:
                self.reply({"service": "Laya", "model": MODEL, "model_available": False, "error": str(exc)})
            return
        if path not in STATIC_FILES:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path not in STATIC_FILES:
            self.send_error(404)
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_POST(self):
        if self.path != "/api/decision":
            self.send_error(404)
            return
        forwarded_ip = self.headers.get("CF-Connecting-IP", "")
        try:
            client_ip = str(ipaddress.ip_address(forwarded_ip)) if forwarded_ip else self.client_address[0]
        except ValueError:
            client_ip = self.client_address[0]
        if not allow_decision(client_ip):
            self.reply({"error": "Too many decisions; wait a minute and try again."}, 429)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 16000:
                self.reply({"error": "Request body must be between 1 and 16000 bytes."}, 413)
                return
            try:
                submitted = json.loads(self.rfile.read(length))
            except json.JSONDecodeError:
                self.reply({"error": "Request body must be valid JSON."}, 400)
                return
            state = sanitize_state(submitted)
            mission = state.get("mission", "protect")
            question = decision_question(state)
            body = json.dumps({
                "model": "typed-decisions",
                "state": state,
                "questions": {"posture": {"type": "choice", **question}},
            }).encode()
            req = urllib.request.Request(f"{DECISION_API}/v1/systemone", data=body, headers={"Content-Type": "application/json"})
            started = time.perf_counter()
            if not model_slots.acquire(blocking=False):
                self.reply({"error": "Decision service is busy; use the local rule fallback."}, 503)
                return
            try:
                with urllib.request.urlopen(req, timeout=8) as r:
                    raw = json.load(r)
            finally:
                model_slots.release()
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
        except ValueError as exc:
            self.reply({"error": "Invalid decision request", "detail": str(exc)}, 400)
        except Exception as exc:
            self.reply({"error": "Decision request failed", "detail": str(exc)}, 500)

    def reply(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
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
