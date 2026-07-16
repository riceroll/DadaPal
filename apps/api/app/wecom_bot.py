#!/usr/bin/env python3
"""Enterprise WeChat transport for the DadaPal conversation engine.

This module deliberately contains no onboarding decision tree.  It persists
the WeCom user's stage, profile, and message history, then calls the existing
``app.bot_engine`` methods used by the web client:

* ``OpenRouterBotEngine.extract_profile`` during ``collecting_profile``;
* ``OpenRouterBotEngine.reply`` for the remaining conversation stages.

The WeCom channel can render only text today, so card actions returned by the
engine are represented as short textual cards.  The action, payload, and next
stage themselves still come from DadaPal's backend engine.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from aibot import WSClient, WSClientOptions, generate_req_id

from app.bot_engine import PROFILE_STAGE_GOAL, BotResult, ProfileDraftResult, get_bot_engine


BOT_ID = os.environ["WECOM_BOT_ID"]
BOT_SECRET = os.environ["WECOM_BOT_SECRET"]
DATABASE_PATH = Path(os.environ.get("DADAPAL_WECOM_DATABASE_PATH", "./wecom_state.db"))
INITIAL_STAGE = "collecting_profile"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("dadapal-wecom")

client = WSClient(WSClientOptions(bot_id=BOT_ID, secret=BOT_SECRET, max_reconnect_attempts=-1))


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATABASE_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    return db


def initialize_database() -> None:
    with closing(connect()) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS wecom_conversations (
                user_id TEXT PRIMARY KEY,
                stage TEXT NOT NULL DEFAULT 'collecting_profile',
                profile_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS wecom_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_wecom_messages_user_id
                ON wecom_messages(user_id, id);
            """
        )
        db.commit()


def ensure_conversation(user_id: str) -> sqlite3.Row:
    with closing(connect()) as db:
        row = db.execute("SELECT * FROM wecom_conversations WHERE user_id = ?", (user_id,)).fetchone()
        if row is None:
            timestamp = now()
            db.execute(
                "INSERT INTO wecom_conversations (user_id, stage, profile_json, created_at, updated_at) "
                "VALUES (?, ?, '{}', ?, ?)",
                (user_id, INITIAL_STAGE, timestamp, timestamp),
            )
            db.commit()
            row = db.execute("SELECT * FROM wecom_conversations WHERE user_id = ?", (user_id,)).fetchone()
        return row


def conversation_profile(conversation: sqlite3.Row) -> dict[str, Any]:
    try:
        profile = json.loads(conversation["profile_json"])
    except (TypeError, json.JSONDecodeError):
        profile = {}
    return profile if isinstance(profile, dict) else {}


def update_conversation(user_id: str, *, stage: str | None = None, profile: dict[str, Any] | None = None) -> None:
    assignments = ["updated_at = ?"]
    values: list[Any] = [now()]
    if stage is not None:
        assignments.append("stage = ?")
        values.append(stage)
    if profile is not None:
        assignments.append("profile_json = ?")
        values.append(json.dumps(profile, ensure_ascii=False))
    values.append(user_id)
    with closing(connect()) as db:
        db.execute(f"UPDATE wecom_conversations SET {', '.join(assignments)} WHERE user_id = ?", values)
        db.commit()


def reset_conversation(user_id: str) -> None:
    with closing(connect()) as db:
        db.execute("DELETE FROM wecom_messages WHERE user_id = ?", (user_id,))
        db.execute(
            "UPDATE wecom_conversations SET stage = ?, profile_json = '{}', updated_at = ? WHERE user_id = ?",
            (INITIAL_STAGE, now(), user_id),
        )
        db.commit()


def store_message(user_id: str, sender: str, text: str) -> None:
    with closing(connect()) as db:
        db.execute(
            "INSERT INTO wecom_messages (user_id, sender, text, created_at) VALUES (?, ?, ?, ?)",
            (user_id, sender, text, now()),
        )
        db.commit()


def recent_history(user_id: str, limit: int = 10) -> list[dict[str, str]]:
    with closing(connect()) as db:
        rows = db.execute(
            "SELECT sender, text FROM wecom_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [
        {"role": "agent" if row["sender"] == "bot" else "user", "text": row["text"]}
        for row in reversed(rows)
    ]


def user_messages(user_id: str) -> list[str]:
    with closing(connect()) as db:
        rows = db.execute(
            "SELECT text FROM wecom_messages WHERE user_id = ? AND sender = 'user' ORDER BY id ASC",
            (user_id,),
        ).fetchall()
    return [str(row["text"]) for row in rows]


def profile_as_dict(result: ProfileDraftResult, previous: dict[str, Any]) -> dict[str, Any]:
    """Keep known fields when a model intentionally leaves them blank."""
    extracted = {
        "nickname": result.nickname,
        "school": result.school,
        "grade": result.grade,
        "major": result.major,
        "city": result.city,
        "current_focus": result.current_focus,
        "seeking": result.seeking,
        "tags": result.tags,
        "confidence_notes": result.confidence_notes,
    }
    merged = dict(previous)
    for key, value in extracted.items():
        if value or key not in merged:
            merged[key] = value
    return merged


def profile_context(user_id: str, latest_input: str, profile: dict[str, Any]) -> dict[str, Any]:
    history = recent_history(user_id, limit=8)
    return {
        "stage": "collecting_profile",
        "stage_goal": PROFILE_STAGE_GOAL,
        "latest_user_input": latest_input,
        "recent_turns": [
            {"role": turn["role"], "text": turn["text"], "stage": "collecting_profile"}
            for turn in history
        ],
        "turn_count": len(user_messages(user_id)),
        "known_profile": profile,
    }


def render_action(result: BotResult) -> str:
    """Render web-only action payloads in plain text without inventing flow logic."""
    if not result.action:
        return result.text

    payload = result.payload
    if result.action in {"show_group_invite", "show_second_group_invite"}:
        card = f"\n\n【群邀请】{payload.get('group_name', 'DadaPal 内测群')}\n{payload.get('description', '')}"
        return result.text + card
    if result.action == "show_candidate_card":
        card = (
            f"\n\n【候选同学】{payload.get('name', '候选同学')}｜{payload.get('school', '')}"
            f"｜{payload.get('major', '')}｜{payload.get('grade', '')}\n"
            f"{payload.get('bio', '')}"
        )
        return result.text + card
    if result.action == "open_questionnaire":
        return result.text + "\n\n【资料卡】企业微信版的小程序资料卡尚未接入；该动作已保留为后端的 open_questionnaire。"
    return result.text


def engine_unavailable_reply() -> str:
    return "我这边的理解服务暂时没连上，不是你说得不清楚。稍等一下再发一次就好。"


def advance(user_id: str, text: str) -> str:
    conversation = ensure_conversation(user_id)
    text = text.strip()
    if text in {"重来", "重新开始", "清空资料"}:
        reset_conversation(user_id)
        return "好，我们重新开始。你可以随意说说：你是谁、最近在忙什么，或者想认识怎样的人？"

    stage = conversation["stage"]
    profile = conversation_profile(conversation)
    engine = get_bot_engine()

    if stage == "collecting_profile":
        if not hasattr(engine, "extract_profile"):
            logger.error("OpenRouter API key is not configured; cannot run LLM profile extraction")
            return engine_unavailable_reply()

        result = engine.extract_profile(
            user_messages(user_id),
            current_profile=profile,
            context=profile_context(user_id, text, profile),
        )
        next_profile = profile_as_dict(result, profile)
        next_stage = "awaiting_profile_form_completion" if result.is_sufficient else "collecting_profile"
        update_conversation(user_id, stage=next_stage, profile=next_profile)
        return result.assistant_reply or result.followup_question or engine_unavailable_reply()

    history = recent_history(user_id)
    result = engine.reply(text, len(history), stage, history)
    update_conversation(user_id, stage=result.next_stage or stage, profile=profile)
    return render_action(result)


def nested_value(payload: Any, keys: tuple[str, ...]) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for value in payload.values():
        found = nested_value(value, keys)
        if found:
            return found
    return None


def user_id_from_frame(frame: dict[str, Any]) -> str:
    value = nested_value(frame, ("userid", "user_id", "from_userid", "external_userid", "open_userid"))
    if value:
        return value
    stable = json.dumps(frame.get("body", {}), ensure_ascii=False, sort_keys=True)
    return "anonymous-" + hashlib.sha256(stable.encode()).hexdigest()[:16]


@client.on("authenticated")
def on_authenticated() -> None:
    initialize_database()
    logger.info("DadaPal LLM adapter connected to WeCom; SQLite=%s", DATABASE_PATH.resolve())


@client.on("disconnected")
def on_disconnected(reason: str) -> None:
    logger.warning("Enterprise WeChat connection closed: %s", reason)


@client.on("error")
def on_error(error: Exception) -> None:
    logger.exception("Enterprise WeChat bot error: %s", error)


@client.on("event.enter_chat")
async def on_enter_chat(frame: dict[str, Any]) -> None:
    ensure_conversation(user_id_from_frame(frame))
    welcome = "嗨，我是哒哒。你可以从任何地方开始说：你最近在忙什么，或者想认识怎样的人？"
    await client.reply_welcome(frame, {"msgtype": "text", "text": {"content": welcome}})


@client.on("message.text")
async def on_text(frame: dict[str, Any]) -> None:
    text = str(frame.get("body", {}).get("text", {}).get("content", "")).strip()
    if not text:
        return
    user_id = user_id_from_frame(frame)
    ensure_conversation(user_id)
    store_message(user_id, "user", text)
    reply = await asyncio.to_thread(advance, user_id, text)
    store_message(user_id, "bot", reply)
    logger.info("Handled %d-character message for user %s", len(text), hashlib.sha256(user_id.encode()).hexdigest()[:8])
    await client.reply_stream(frame, generate_req_id("reply"), reply, finish=True)


if __name__ == "__main__":
    initialize_database()
    logger.info("Starting DadaPal Enterprise WeChat LLM adapter")
    client.run()
