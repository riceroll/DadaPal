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