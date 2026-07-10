from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SessionCreate(BaseModel):
    display_name: str = "DadaPal Guest"


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str
    created_at: datetime


class MessageCreate(BaseModel):
    session_id: str
    text: str
    stage: str | None = None


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    sender: str
    text: str
    created_at: datetime | None = None


class ChatReply(BaseModel):
    user_message: MessageRead
    bot_message: MessageRead
    quick_replies: list[str] = Field(default_factory=list)
    action: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    next_stage: str | None = None


class ProfileDraft(BaseModel):
    nickname: str = ""
    school: str = ""
    grade: str = ""
    major: str = ""
    city: str = ""
    current_focus: str = ""
    seeking: str = ""
    tags: list[str] = Field(default_factory=list)
    confidence_notes: str = ""


class ConversationTurn(BaseModel):
    role: Literal["user", "agent"]
    text: str
    stage: str | None = None


class ConversationContext(BaseModel):
    stage: str = "collecting_profile"
    stage_goal: str = ""
    latest_user_input: str = ""
    recent_turns: list[ConversationTurn] = Field(default_factory=list)
    turn_count: int = 0
    known_profile: ProfileDraft | None = None


class ProfileExtractRequest(BaseModel):
    messages: list[str]
    current_profile: ProfileDraft | None = None
    stage: str | None = None
    context: ConversationContext | None = None


class ProfileExtractResponse(BaseModel):
    profile: ProfileDraft
    missing_fields: list[str] = Field(default_factory=list)
    is_sufficient: bool = False
    followup_question: str = ""
    natural_summary: str = ""
    assistant_reply: str = ""


class OnboardingAnswerCreate(BaseModel):
    session_id: str
    question_key: str
    answer: str


class FeedbackCreate(BaseModel):
    session_id: str
    target_type: str
    target_id: str
    action: str


class GroupInvite(BaseModel):
    title: str
    description: str
    qr_code_url: str