# Human-side decision model

The game calls Laya's `laya-typed-decisions` checkpoint. Laya is an open, trained, non-autoregressive typed-decision model: it scores a caller-supplied set of choices and returns a probability distribution, without generating text. This is distinct from using a general chat model as a classifier.

- Project and Apache-2.0 license: https://github.com/NandhaKishorM/laya
- Checkpoint: https://huggingface.co/convaiinnovations/laya-typed-decisions
- The selected checkpoint has 421M parameters and a 1,024-token context. The project reports 0.766 accuracy on its 2,000-item typed-decisions benchmark; that benchmark covers four non-game workflows, so it is not evidence of zombie-game skill.
- Laya reports 33 ms p50 for one question on a T4 GPU. That is the project's published measurement, not a measurement on this Mac. The game records its own end-to-end local request latency.

The game sends a compact snapshot of visible enemies and current squad results, then offers only actions that are currently executable. The choices are `SCOUT` (split mobile teams across unexplored rooms), `SUPPRESS` (focus a visible close threat), `FLANK` (mobile teams move around a marked threat while support weapons cover), `ASSAULT` (rifles and shotguns prioritize the discovered mother), `REGROUP` (move to a safe supply point), and `DEFEND` (hold separate sectors around the seed vault). Changing the action changes unit routes, formation, or target priority. Close-contact evasion and individual ammunition resupply remain local safety behaviors. The browser draws the assigned routes, targets, current roles, probabilities, and a recent decision history. The model is called every six seconds without blocking the render loop; a stalled, ineffective suppression/flank order is removed from the next candidate set. If Laya is unavailable, the panel identifies the deterministic rule baseline.

The checkpoint is decision-specialized, but it has not been fine-tuned on this game's tactical states. A game-specific training run would need labeled or self-play episodes and an evaluation set before replacing the current checkpoint.

The candidate actions are built from the snapshot on both client and server, so hidden enemies cannot create a suppression order and the server rejects choices that are no longer legal. The UI shows Laya’s raw probabilities separately from the executed order. These action descriptions and eligibility rules are not newly trained model behavior; the checkpoint itself still needs game-specific training and evaluation.

Direct local API checks produced `SCOUT` when the nest was quiet, `SUPPRESS` under close contact, `REGROUP` under widespread ammunition shortage, and `ASSAULT` once the mother was visible. Single legal actions receive probability 1 by construction; when several actions are legal, the checkpoint ranks them. This validates the action contract and mapping, not tactical quality across a full match.

## Run locally

Laya requires Python 3.10 or newer. From this directory, create a Python 3.12 environment and install the local service:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install 'laya[serve]'
```

On Apple Silicon, start the trained decision checkpoint with MPS:

```sh
LAYA_HOST=127.0.0.1 LAYA_PORT=8790 LAYA_DEVICE=mps LAYA_MODELS=typed-decisions LAYA_PRELOAD=1 .venv/bin/laya-serve
```

The first start downloads the checkpoint from Hugging Face. In a second terminal, serve the game:

```sh
PORT=8001 python3 server.py
```

Open http://127.0.0.1:8001. The model request endpoint is local at `http://127.0.0.1:8790/v1/systemone`.
