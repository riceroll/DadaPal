import json

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.bot_engine import get_bot_engine
from app.config import get_settings
from app.database import Base, engine, get_db
from app.models import ChatMessage, ChatSession, Feedback, OnboardingAnswer
from app.schemas import (
    ChatReply,
    FeedbackCreate,
    GroupInvite,
    MessageCreate,
    MessageRead,
    OnboardingAnswerCreate,
    ProfileDraft,
    ProfileExtractRequest,
    ProfileExtractResponse,
    SessionCreate,
    SessionRead,
    TarotInterpretRequest,
    TarotInterpretResponse,
)

settings = get_settings()

app = FastAPI(title="DadaPal API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def create_tables() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "dadapal-api"}


@app.post("/sessions", response_model=SessionRead)
def create_session(payload: SessionCreate, db: Session = Depends(get_db)) -> ChatSession:
    session = ChatSession(display_name=payload.display_name)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@app.get("/chat/messages", response_model=list[MessageRead])
def list_messages(session_id: str, db: Session = Depends(get_db)) -> list[ChatMessage]:
    return list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.asc())
        )
    )


@app.post("/chat/messages", response_model=ChatReply)
def create_message(payload: MessageCreate, db: Session = Depends(get_db)) -> ChatReply:
    session = db.get(ChatSession, payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    user_message = ChatMessage(session_id=session.id, sender="user", text=payload.text)
    db.add(user_message)
    db.flush()

    message_count = db.scalar(select(func.count()).select_from(ChatMessage).where(ChatMessage.session_id == session.id)) or 0
    history_rows = list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.session_id == session.id)
            .order_by(ChatMessage.created_at.asc())
        )
    )
    history = [{"role": "agent" if row.sender == "bot" else "user", "text": row.text} for row in history_rows[-10:]]
    bot_result = get_bot_engine().reply(payload.text, message_count, payload.stage or "intro", history)
    bot_message = ChatMessage(session_id=session.id, sender="bot", text=bot_result.text)
    db.add(bot_message)
    db.commit()
    db.refresh(user_message)
    db.refresh(bot_message)

    return ChatReply(
        user_message=user_message,
        bot_message=bot_message,
        quick_replies=bot_result.quick_replies,
        action=bot_result.action,
        payload=bot_result.payload,
        next_stage=bot_result.next_stage,
    )


@app.post("/profile/extract", response_model=ProfileExtractResponse)
def extract_profile(payload: ProfileExtractRequest) -> ProfileExtractResponse:
    engine = get_bot_engine()
    if hasattr(engine, "extract_profile"):
        current_profile = payload.current_profile.model_dump() if payload.current_profile else {}
        context = payload.context.model_dump() if payload.context else None
        result = engine.extract_profile(payload.messages, current_profile, context)
    else:
        current = payload.current_profile or ProfileDraft()
        result = ProfileDraft(
            school=current.school,
            grade=current.grade,
            major=current.major,
            city=current.city,
            current_focus=current.current_focus,
            seeking=current.seeking,
            tags=current.tags,
        )
        return ProfileExtractResponse(
            profile=result,
            missing_fields=["current_focus", "seeking"],
            is_sufficient=False,
            followup_question="我还差一点点信息：你最近主要在忙什么，或者最想认识什么类型的人？",
            natural_summary="",
            assistant_reply="我还差一点点信息：你最近主要在忙什么，或者最想认识什么类型的人？",
        )

    return ProfileExtractResponse(
        profile=ProfileDraft(
            nickname=result.nickname,
            school=result.school,
            grade=result.grade,
            major=result.major,
            city=result.city,
            current_focus=result.current_focus,
            seeking=result.seeking,
            tags=result.tags,
            confidence_notes=result.confidence_notes,
        ),
        missing_fields=result.missing_fields,
        is_sufficient=result.is_sufficient,
        followup_question=result.followup_question,
        natural_summary=result.natural_summary,
        assistant_reply=result.assistant_reply,
    )


@app.post("/tarot/interpret", response_model=TarotInterpretResponse)
def interpret_tarot(payload: TarotInterpretRequest) -> TarotInterpretResponse:
    cards = "；".join(f"{card.title}（{'逆位' if card.reversed else '正位'}）：{card.line}" for card in payload.cards)
    fallback = TarotInterpretResponse(
        surface=f"**牌面元素**：{cards}。三张牌把食堂、校门、宿舍、图书馆或操场这些校园日常意象放进同一张桌布上。它们不是抽象符号，而是提醒你看见真实的节奏：谁愿意停下来一起吃饭，谁在路过时多说了一句，谁把原本普通的并肩变成了可以继续的话题。表层上，这是一组关于相遇、回应与轻松靠近的牌。",
        depth="**深层关系**：你问的并不只是结果，而是自己有没有勇气把心里的好奇交给现实检验。牌面建议你保留一点**不急着定义**的空间：不用先判断这是不是命定关系，也不必用一次互动证明全部可能。真正值得观察的，是对方是否会持续、自然地把回应还给你。",
        structure="**组合结构**：第一张牌铺开你当前所处的情绪与环境，第二张牌像一扇正在打开的门，指出最容易发生连接的触发点；第三张牌则把故事落回一个具体动作。这三张牌不是线性的预言，而是一个由感受、邀请到反馈组成的**小循环**，让你可以在校园生活里慢慢验证。",
        guidance="**指引**：接下来一周，挑一个低压力但可被回应的行动：问一句“要不要一起吃饭”、约一次课后散步，或在共同任务里递出一个具体的小邀请。预测不在于某个人一定会出现，而在于当你不再把主动当成冒险，关系更可能从一次真实、轻盈的互动里自然长出来。",
    )
    if not settings.openrouter_api_key:
        return fallback
    prompt = (
        "你是一位专业、温柔但不作确定预言的校园塔罗解读师。根据问题和三张牌，输出 JSON 对象，严格只有 surface、depth、structure、guidance 四个中文字符串字段。"
        "四段总计不少于 850 个中文字符，每段 180-260 字；用 **关键词** 做 1-2 处加粗；第一段逐张解释元素与表层含义，第二段联系提问做深层分析，"
        "第三段解释三张牌的结构关系，第四段给出具体、低风险的预测或行动指引。避免医疗、财务、绝对化结论。"
        f"\n问题：{payload.question}\n牌：{cards}"
    )
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}", "Content-Type": "application/json"},
                json={"model": settings.openrouter_model, "messages": [{"role": "user", "content": prompt}], "response_format": {"type": "json_object"}, "max_tokens": 1400, "reasoning": {"effort": "none"}},
            )
            response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return TarotInterpretResponse.model_validate(json.loads(content))
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return fallback


@app.post("/onboarding/answers")
def save_onboarding_answer(payload: OnboardingAnswerCreate, db: Session = Depends(get_db)) -> dict[str, str]:
    answer = OnboardingAnswer(
        session_id=payload.session_id,
        question_key=payload.question_key,
        answer=payload.answer,
    )
    db.add(answer)
    db.commit()
    return {"status": "saved", "id": answer.id}


@app.post("/feedback")
def save_feedback(payload: FeedbackCreate, db: Session = Depends(get_db)) -> dict[str, str]:
    feedback = Feedback(
        session_id=payload.session_id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        action=payload.action,
    )
    db.add(feedback)
    db.commit()
    return {"status": "saved", "id": feedback.id}


@app.get("/groups/invite", response_model=GroupInvite)
def get_group_invite() -> GroupInvite:
    return GroupInvite(
        title="DadaPal 新生内测群",
        description="模拟企业微信群二维码。正式企业微信接入后会替换为真实邀请。",
        qr_code_url="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=DadaPal-demo-group",
    )