from dataclasses import dataclass, field
import json
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.config import get_settings


VALID_STAGES = {
    "intro",
    "collecting_profile",
    "awaiting_profile_form_completion",
    "suggest_first_group",
    "recommend_candidate",
    "ask_contact_permission",
    "suggest_second_group",
    "freeform_followup",
}

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

PROFILE_STAGE_GOAL = (
    "获得足够清晰的用户画像和连接需求：用户是谁/在哪个学校或阶段，最近在忙什么，"
    "以及想认识什么样的人或资源。如果用户没有明确需求，随便看看/没有需求也可以作为 seeking。"
)

PROFILE_STAGE_RULES = (
    "你是 AAA哒哒大王，一个微信语气的校园 connect 助手。当前只做画像收集，不推荐真实人。"
    "每次都要围绕阶段目标推进：用户问这是什么就解释并给例子；用户拒绝就说明没有一点信息无法匹配，"
    "但允许跳过或随便看看；用户偏题或情绪化就简短接住，再拉回画像目标。"
    "不要因为 bot 开场提到上海交大/复旦/同济就把学校填给用户；只有用户明确说过或 current_profile 已有时才填字段。"
    "assistant_reply 要像微信聊天，1-3 句，不要机械重复上一轮模板。"
    "如果你还想追问任何新的画像细节，比如专业方向、最近具体在忙什么、项目阶段，就必须把 is_sufficient 设为 false。"
    "但 seeking 只需要知道大致方向或对象类型（哪怕很笼统，比如'创业伙伴''社交方向'都算），"
    "一旦已经有 school/grade/major/current_focus 且 seeking 有大致方向，就不要再追问 seeking 更细分的子问题"
    "（比如具体赛道、技术还是运营、哪个细分领域），最多针对 seeking 追问一次即可，之后必须收尾。"
    "只有当画像收集阶段可以收尾时，才把 is_sufficient 设为 true；此时 assistant_reply 不是在问用户对不对，"
    "而是要自然地把对话推进到下一步：告诉用户你已经了解得差不多了，接下来要去帮 Ta 找人/找群，"
    "并且会先给 Ta 草拟一版资料卡，请 Ta 补充/确认一下，这样后面匹配会更准。语气要像真的要往下推进，而不是停下来等确认。"
)


class IntentResult(BaseModel):
    intent: str = Field(default="unknown")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reply_hint: str = Field(default="")
    source: str = Field(default="rules")


class ProfileDraftResult(BaseModel):
    nickname: str = ""
    school: str = ""
    grade: str = ""
    major: str = ""
    city: str = ""
    current_focus: str = ""
    seeking: str = ""
    tags: list[str] = Field(default_factory=list)
    confidence_notes: str = ""
    missing_fields: list[str] = Field(default_factory=list)
    is_sufficient: bool = False
    followup_question: str = ""
    natural_summary: str = ""
    assistant_reply: str = ""


@dataclass(frozen=True)
class BotResult:
    text: str
    quick_replies: list[str]
    action: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    next_stage: str | None = None


class MockBotEngine:
    def reply(
        self,
        text: str,
        message_count: int,
        stage: str = "intro",
        history: list[dict[str, str]] | None = None,
    ) -> BotResult:
        normalized = text.strip().lower()

        if stage in VALID_STAGES:
            return DecisionTreeBotEngine().reply(text, message_count, stage, history)

        if message_count <= 2:
            return BotResult(
                text="你好，我是哒哒企业号助手。我们先用几个问题帮你建立 profile，之后会推荐同学和活动。你现在在哪个学校或城市？",
                quick_replies=["上海", "北京", "海外", "还没确定"],
            )
        if "群" in text or "二维码" in text:
            return BotResult(
                text="可以，我给你一个模拟群二维码。真实企业微信接好后，这里会换成正式群邀请。",
                quick_replies=["查看群二维码", "继续完善画像"],
            )
        if "活动" in text:
            return BotResult(
                text="今天的模拟活动推荐：周日晚上的新生线上破冰局，适合想先认识同校同届朋友的人。",
                quick_replies=["感兴趣", "换一个", "拉我进群"],
            )
        if "match" in normalized or "匹配" in text or "朋友" in text:
            return BotResult(
                text="我找到一个模拟匹配：同样在上海、喜欢 AI 产品和城市探索的新生。V1 先展示流程，V2 会用 OpenRouter 做更自然的追问。",
                quick_replies=["想认识", "暂时跳过", "看看活动"],
            )

        return BotResult(
            text="收到。我会把这个作为画像线索记录下来。再告诉我一个偏好：你更想认识同校朋友、同城朋友，还是一起参加活动的人？",
            quick_replies=["同校朋友", "同城朋友", "活动搭子", "都可以"],
        )


class DecisionTreeBotEngine:
    def reply(
        self,
        text: str,
        message_count: int,
        stage: str = "intro",
        history: list[dict[str, str]] | None = None,
    ) -> BotResult:
        del message_count, history
        del text
        intent = "unknown"

        if stage == "suggest_first_group":
            if intent == "accept_group":
                return BotResult(
                    text="好呀，我先把你拉进这个群～同时我继续在库里帮你捞更具体的人选。",
                    quick_replies=["看看候选人", "先逛群"],
                    action="show_group_invite",
                    payload=first_group_payload(),
                    next_stage="recommend_candidate",
                )
            if intent == "decline":
                return BotResult(
                    text="没问题，那我先不拉群。我继续帮你精细筛人，有靠谱的再来戳你～",
                    quick_replies=["继续筛", "换个方向"],
                    next_stage="freeform_followup",
                )

            return BotResult(
                text="这个群主要是交大、复旦、同济同学互相答疑，也会同步活动和组织招募。你想先进群看看吗？",
                quick_replies=["好的", "先不用"],
                next_stage="suggest_first_group",
            )

        if stage == "recommend_candidate":
            return BotResult(
                text="我又找到一位可能合适的同学，先把 Ta 的学生证发你看看～",
                quick_replies=["可以联系", "先不要"],
                action="show_candidate_card",
                payload=candidate_payload(),
                next_stage="ask_contact_permission",
            )

        if stage == "ask_contact_permission":
            if intent == "accept_contact":
                return BotResult(
                    text="好嘞，我帮你打个招呼～你们可以先加微信继续聊。另外再给你一个更垂直的组队群，双线并行更快。",
                    quick_replies=["加入组队群", "继续推荐"],
                    action="show_second_group_invite",
                    payload=second_group_payload(),
                    next_stage="suggest_second_group",
                )
            if intent == "decline":
                return BotResult(
                    text="收到，那我先不帮你联系本人。先给你一个偏项目协作的群，你可以观察一下氛围～",
                    quick_replies=["加入组队群", "继续筛人"],
                    action="show_second_group_invite",
                    payload=second_group_payload(),
                    next_stage="suggest_second_group",
                )

            return BotResult(
                text="你想让我帮你联系这位同学吗？可以回我“可以联系”或者“先不要”。",
                quick_replies=["可以联系", "先不要"],
                next_stage="ask_contact_permission",
            )

        if stage == "intro":
            return BotResult(
                text="收到，我先记下你的方向。我会先找一个适合围观的群，再帮你筛具体同学。",
                quick_replies=["好的", "我想找同学", "我想找活动"],
                next_stage="suggest_first_group",
            )

        return BotResult(
            text="收到啦，我继续按你刚刚说的方向帮你筛。有更具体的偏好也可以直接丢给我，比如学校、专业、活动类型。",
            quick_replies=["找同校", "找跨校项目", "找活动搭子"],
            next_stage="freeform_followup",
        )


class OpenRouterBotEngine:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.fallback = DecisionTreeBotEngine()

    def reply(
        self,
        text: str,
        message_count: int,
        stage: str = "intro",
        history: list[dict[str, str]] | None = None,
    ) -> BotResult:
        model_intent = self._classify(text, stage, history or [])
        intent = model_intent.intent if model_intent.confidence >= 0.5 else "unknown"
        guided_text = model_intent.reply_hint.strip()

        result = self._reply_from_intent(intent, text, message_count, stage, history)
        # Only use the classifier's reply_hint for generic fallback conversation.
        # When _reply_from_intent returns a specific action (group invite, candidate
        # card, questionnaire, etc.), the result.text is intentional stage-transition
        # copy and must not be overridden by the classifier's generic reply_hint.
        if guided_text and not result.action:
            return BotResult(
                text=guided_text,
                quick_replies=result.quick_replies,
                action=result.action,
                payload=result.payload,
                next_stage=result.next_stage,
            )
        return result

    def _reply_from_intent(
        self,
        intent: str,
        text: str,
        message_count: int,
        stage: str,
        history: list[dict[str, str]] | None,
    ) -> BotResult:
        del text, message_count, history

        if stage == "awaiting_profile_form_completion":
            return BotResult(
                text="这一步需要在资料卡里补完，我再继续帮你匹配。",
                quick_replies=[],
                action="open_questionnaire",
                next_stage="awaiting_profile_form_completion",
            )

        if stage == "suggest_first_group":
            if intent == "accept_group":
                return BotResult(
                    text="好，我先把群入口给你。与此同时我继续往下找更贴的人选。",
                    quick_replies=[],
                    action="show_group_invite",
                    payload=first_group_payload(),
                    next_stage="ask_contact_permission",
                )
            if intent == "decline":
                return BotResult(
                    text="好，那这个大群先不进。我继续直接帮你找更贴的人选。",
                    quick_replies=[],
                    next_stage="ask_contact_permission",
                )
            return BotResult(
                text="我没太确定你是想先进群看看，还是先跳过大群。你可以按你的真实想法回我。",
                quick_replies=[],
                next_stage="suggest_first_group",
            )

        if stage == "ask_contact_permission":
            if intent in {"accept_contact", "accept_group"}:
                return BotResult(
                    text="好，我给你开一个低压认识的小群，你们先随便打个招呼。",
                    quick_replies=[],
                    action="show_second_group_invite",
                    payload=second_group_payload(),
                    next_stage="freeform_followup",
                )
            if intent == "decline":
                return BotResult(
                    text="没问题，那我先不安排这个连接。我继续按你的方向帮你找别的线索。",
                    quick_replies=[],
                    next_stage="freeform_followup",
                )
            return BotResult(
                text="我没太确定你是不是想认识这位同学。你可以直接说想认识、先不要，或者告诉我想换个方向。",
                quick_replies=[],
                next_stage="ask_contact_permission",
            )

        if stage == "freeform_followup":
            return BotResult(
                text=guided_fallback_text(intent),
                quick_replies=[],
                next_stage="freeform_followup",
            )

        return BotResult(
            text="我收到啦。你再多说一点点你的意思，我会按当前进度继续往下推进。",
            quick_replies=[],
            next_stage=stage,
        )

    def _classify(self, text: str, stage: str, history: list[dict[str, str]]) -> IntentResult:
        models = [self.settings.openrouter_model]
        fallback_model = self.settings.openrouter_fallback_model.strip()
        if fallback_model and fallback_model not in models:
            models.append(fallback_model)

        for model in models:
            result = self._classify_with_model(model, text, stage, history)
            if result is not None:
                return result

        return IntentResult(intent="unknown", confidence=0.0, reply_hint="", source="model_unavailable")

    def _classify_with_model(
        self,
        model: str,
        text: str,
        stage: str,
        history: list[dict[str, str]],
    ) -> IntentResult | None:
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是 DadaPal 后端的意图分类器。只返回 JSON，不要 markdown。"
                        "根据当前 stage 和用户中文自然语言判断 intent，一定要结合 recent_history 里最后一条 agent 消息在问什么来判断，"
                        "而不是只看 user_text 本身的字面意思。"
                        "允许 intent: accept_group, decline, accept_contact, ask_question, provide_profile, unknown。"
                        "accept_group = 同意加群/同意看看/同意认识候选人；accept_contact = 同意加好友/建立联系；"
                        "decline = 不想/暂时不要/拒绝。"
                        "如果 recent_history 最后一条 agent 消息是在问要不要加群、要不要认识某人、要不要加好友这类是非问题，"
                        "那么像“好呀”“好的”“好嘞”“可以”“可以的”“行”“嗯”“没问题”“中”这种简短肯定词，必须判定为 accept_group 或 accept_contact"
                        "（按最近那个问题问的是加群还是加好友来选），不要判为 unknown；"
                        "同理“不用了”“算了”“先不要”“不想”这种简短否定词必须判定为 decline。"
                        "对于这种明确的简短肯定/否定回复，confidence 至少给到 0.8，不要因为句子短就压低置信度。"
                        "reply_hint 必须提供一句轻松微信语气中文回复，长度20-60字。"
                        "不要承诺100%匹配，不要编造真实学生身份。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"stage={stage}\n"
                        f"recent_history={history[-6:]}\n"
                        f"user_text={text}\n"
                        "Return JSON with keys: intent, confidence, reply_hint, source."
                    ),
                },
            ],
            "temperature": 0.2,
            "max_tokens": 300,
            "reasoning": {"effort": "none"},
            "response_format": {"type": "json_object"},
        }

        try:
            with httpx.Client(timeout=12.0) as client:
                response = client.post(
                    OPENROUTER_URL,
                    headers={
                        "Authorization": f"Bearer {self.settings.openrouter_api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://dadapal.local",
                        "X-Title": "DadaPal",
                    },
                    json=payload,
                )
                response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = IntentResult.model_validate_json(content)
            return IntentResult(
                intent=parsed.intent,
                confidence=parsed.confidence,
                reply_hint=parsed.reply_hint,
                source=f"openrouter:{model}",
            )
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, ValidationError):
            return None

    def extract_profile(
        self,
        messages: list[str],
        current_profile: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> ProfileDraftResult:
        models = [self.settings.openrouter_model]
        fallback_model = self.settings.openrouter_fallback_model.strip()
        if fallback_model and fallback_model not in models:
            models.append(fallback_model)

        for model in models:
            for _ in range(2):
                result = self._extract_profile_with_model(model, messages, current_profile or {}, context)
                if result is not None:
                    return sanitize_profile_result(result, messages, current_profile or {}, context)

        return profile_model_unavailable_result(current_profile or {})

    def _extract_profile_with_model(
        self,
        model: str,
        messages: list[str],
        current_profile: dict[str, Any],
        context: dict[str, Any] | None = None,
    ) -> ProfileDraftResult | None:
        user_content = build_profile_turn_prompt(messages, current_profile, context)
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"{PROFILE_STAGE_RULES}只返回 JSON，不要 markdown。"
                        "你需要根据用户多轮中文自然语言，抽取校园社交匹配所需画像。"
                        "不要机械复制原句到错误字段；不知道就留空。"
                        "school 是学校，如上海交大/复旦/同济；grade 是年级；major 是专业。"
                        "current_focus 是最近在忙/人生节点，例如转专业、做项目、准备比赛。"
                        "seeking 是想认识的人或资源，例如创业伙伴、同专业前辈、活动搭子。"
                        "is_sufficient 为 true 的条件：大致知道用户是谁，并知道连接需求；随便看看/没有明确需求也算连接需求。"
                        "natural_summary 要像真人复述确认，不要列表，不要出现占位词。"
                        "followup_question 只问一个最关键缺口，不要重复已经知道的信息。"
                        "assistant_reply 是这一轮直接发给用户的话。"
                        "如果 assistant_reply 里还要问用户补充专业方向、近期安排、项目阶段等新画像字段，is_sufficient 必须是 false。"
                        "如果 is_sufficient 为 true，assistant_reply 不要只输出总结，也不要问用户对不对；"
                        "要自然地说接下来会去帮用户找人/找群，并且会先给用户一版资料卡草稿，请用户补充/确认一下，语气是往下推进而不是停下来等待。"
                    ),
                },
                {
                    "role": "user",
                    "content": user_content,
                },
            ],
            "temperature": 0.1,
            "max_tokens": 800,
            "reasoning": {"effort": "none"},
            "response_format": {"type": "json_object"},
        }

        try:
            with httpx.Client(timeout=20.0) as client:
                response = client.post(
                    OPENROUTER_URL,
                    headers={
                        "Authorization": f"Bearer {self.settings.openrouter_api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://dadapal.local",
                        "X-Title": "DadaPal",
                    },
                    json=payload,
                )
                response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = ProfileDraftResult.model_validate_json(content)
            return normalize_profile_result(parsed)
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, ValidationError):
            return None


def build_profile_turn_prompt(
    messages: list[str],
    current_profile: dict[str, Any],
    context: dict[str, Any] | None,
) -> str:
    if context:
        recent_turns = [
            {
                "role": turn.get("role"),
                "text": turn.get("text"),
                "stage": turn.get("stage"),
            }
            for turn in context.get("recent_turns", [])[-8:]
            if isinstance(turn, dict) and turn.get("text")
        ]
        prompt = {
            "current_stage": context.get("stage") or "collecting_profile",
            "stage_goal": context.get("stage_goal") or PROFILE_STAGE_GOAL,
            "latest_user_input": context.get("latest_user_input") or (messages[-1] if messages else ""),
            "current_profile": current_profile,
            "recent_role_marked_turns": recent_turns,
            "agent_task": (
                "根据最近对话继续推进画像收集。先理解用户当前是在提问、拒绝、偏题、辱骂、跳过，还是提供画像。"
                "只抽取用户明确给出的画像，不要抽取 agent 说过的例子。返回自然、不重复模板的 assistant_reply。"
            ),
            "output_schema": [
                "nickname",
                "school",
                "grade",
                "major",
                "city",
                "current_focus",
                "seeking",
                "tags",
                "confidence_notes",
                "missing_fields",
                "is_sufficient",
                "followup_question",
                "natural_summary",
                "assistant_reply",
            ],
        }
        return json.dumps(prompt, ensure_ascii=False)

    prompt = {
        "current_stage": "collecting_profile",
        "stage_goal": PROFILE_STAGE_GOAL,
        "current_profile": current_profile,
        "user_messages": messages,
        "agent_task": "抽取用户画像并生成下一句自然追问。不要使用 agent 例子当作用户信息。",
        "output_schema": [
            "nickname",
            "school",
            "grade",
            "major",
            "city",
            "current_focus",
            "seeking",
            "tags",
            "confidence_notes",
            "missing_fields",
            "is_sufficient",
            "followup_question",
            "natural_summary",
            "assistant_reply",
        ],
    }
    return json.dumps(prompt, ensure_ascii=False)


def context_user_messages(messages: list[str], context: dict[str, Any] | None) -> list[str]:
    if not context:
        return messages
    user_turns = [
        str(turn.get("text") or "")
        for turn in context.get("recent_turns", [])
        if isinstance(turn, dict) and turn.get("role") == "user" and turn.get("text")
    ]
    latest = str(context.get("latest_user_input") or "")
    if latest and (not user_turns or user_turns[-1] != latest):
        user_turns.append(latest)
    return user_turns or messages


def sanitize_profile_result(
    result: ProfileDraftResult,
    messages: list[str],
    current_profile: dict[str, Any],
    context: dict[str, Any] | None,
) -> ProfileDraftResult:
    user_messages = context_user_messages(messages, context)
    evidence_text = "，".join(user_messages).lower()

    if result.school and not school_has_evidence(result.school, evidence_text, current_profile):
        result.school = str(current_profile.get("school") or "")
    if result.grade and result.grade not in evidence_text and result.grade != str(current_profile.get("grade") or ""):
        result.grade = str(current_profile.get("grade") or "")

    if not any([result.school, result.grade, result.current_focus, result.seeking]) and not any(str(current_profile.get(key) or "").strip() for key in ["school", "grade", "current_focus", "seeking"]):
        result.is_sufficient = False
        result.natural_summary = ""

    return normalize_profile_result(result)


def school_has_evidence(school: str, evidence_text: str, current_profile: dict[str, Any]) -> bool:
    current_school = str(current_profile.get("school") or "")
    if current_school and school == current_school:
        return True
    if "交大" in school or "交通" in school:
        return "交大" in evidence_text or "上海交通" in evidence_text
    if "复旦" in school:
        return "复旦" in evidence_text
    if "同济" in school:
        return "同济" in evidence_text
    return school.lower() in evidence_text


def profile_model_unavailable_result(current_profile: dict[str, Any]) -> ProfileDraftResult:
    return ProfileDraftResult(
        nickname=str(current_profile.get("nickname") or ""),
        school=str(current_profile.get("school") or ""),
        grade=str(current_profile.get("grade") or ""),
        major=str(current_profile.get("major") or ""),
        city=str(current_profile.get("city") or ""),
        current_focus=str(current_profile.get("current_focus") or ""),
        seeking=str(current_profile.get("seeking") or ""),
        tags=[str(tag) for tag in current_profile.get("tags") or [] if str(tag).strip()],
        is_sufficient=False,
        followup_question="我这边的理解服务刚刚开小差了，不是你说得不清楚。你可以稍等一下再发，或者直接点一下重试。",
        assistant_reply="我这边的理解服务刚刚开小差了，不是你说得不清楚。你可以稍等一下再发，或者直接点一下重试。",
    )


def guided_fallback_text(intent: str) -> str:
    if intent == "ask_question":
        return "我可以继续解释，也可以直接帮你找群和人。你告诉我现在更想看哪一种就行。"
    if intent == "provide_profile":
        return "收到，我会把这个作为新的方向记住，再继续帮你筛更贴的线索。"
    return "收到。我会按刚刚的方向继续推进，你也可以直接补充想找的人、群或者活动。"


def normalize_profile_result(result: ProfileDraftResult) -> ProfileDraftResult:
    city = result.city.strip()
    if not city and result.school.strip() in {"上海交大", "上海交通大学", "复旦", "复旦大学", "同济", "同济大学"}:
        city = "上海"

    known = {
        "school": result.school,
        "grade": result.grade,
        "major": result.major,
        "city": city,
        "current_focus": result.current_focus,
        "seeking": result.seeking,
    }
    core_fields = {"school", "grade", "seeking"}
    missing = [key for key, value in known.items() if key in core_fields and not value.strip()]
    is_sufficient = result.is_sufficient
    followup = result.followup_question.strip()
    summary = result.natural_summary.strip()
    assistant_reply = result.assistant_reply.strip() or summary or followup

    return ProfileDraftResult(
        nickname=result.nickname.strip(),
        school=result.school.strip(),
        grade=result.grade.strip(),
        major=result.major.strip(),
        city=city,
        current_focus=result.current_focus.strip(),
        seeking=result.seeking.strip(),
        tags=[tag.strip() for tag in result.tags if tag.strip()],
        confidence_notes=result.confidence_notes.strip(),
        missing_fields=[field for field in (result.missing_fields or missing) if field in core_fields and not known.get(field, "").strip()],
        is_sufficient=is_sufficient,
        followup_question=followup,
        natural_summary=summary,
        assistant_reply=assistant_reply,
    )


def build_fallback_profile_summary(profile: ProfileDraftResult) -> str:
    identity = "".join([profile.school, profile.grade]) or "你的基础信息"
    focus_part = f"，最近在{profile.current_focus}" if profile.current_focus else ""
    if "随便看看" in profile.seeking or "没有明确需求" in profile.seeking:
        seeking_part = "，现在没有特别明确的需求，可以先看看群和活动"
    else:
        seeking_part = f"，也想连接{profile.seeking}" if profile.seeking else ""
    return f"我先确认一下，我理解你是{identity}的同学{focus_part}{seeking_part}。如果这个方向没偏，我就按这个去帮你找合适的人和群。"


def first_group_payload() -> dict[str, Any]:
    return {
        "group_name": "沪上校园生存指南群",
        "description": "群里有学长学姐答疑，也会同步交大/复旦/同济的活动情报。",
    }


def second_group_payload() -> dict[str, Any]:
    return {
        "group_name": "沪上跨校项目组队群",
        "description": "这里主要是交大/复旦/同济跨校组队，适合找队友做比赛和项目。",
    }


def candidate_payload() -> dict[str, Any]:
    return {
        "name": "林知夏",
        "school": "同济大学",
        "student_id": "TJU-2024-1782",
        "major": "工业设计",
        "grade": "大三",
        "focus": "AI + 交互设计作品集",
        "bio": "最近在做校园服务机器人方向，想找跨校小伙伴一起冲比赛和作品集。",
        "tags": ["同济", "AI设计", "作品集", "线下约讨论"],
        "avatar_url": "https://api.dicebear.com/9.x/thumbs/svg?seed=dadapal-match",
    }


def get_bot_engine() -> MockBotEngine | OpenRouterBotEngine:
    settings = get_settings()
    if settings.openrouter_api_key:
        return OpenRouterBotEngine()
    return MockBotEngine()