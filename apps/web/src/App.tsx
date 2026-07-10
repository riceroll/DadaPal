import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || 'http://localhost:8000'

type BackendChatReply = {
  bot_message: {
    text: string
  }
  action?: string | null
  payload?: Record<string, unknown>
  next_stage?: string | null
}

type BackendProfileDraft = {
  nickname: string
  school: string
  grade: string
  major: string
  city: string
  current_focus: string
  seeking: string
  tags: string[]
  confidence_notes: string
}

type BackendProfileExtractResponse = {
  profile: BackendProfileDraft
  missing_fields: string[]
  is_sufficient: boolean
  followup_question: string
  natural_summary: string
  assistant_reply: string
}

type BackendConversationTurn = {
  role: 'user' | 'agent'
  text: string
  stage?: string
}

type TextMessage = {
  kind: 'text'
  id: string
  sender: 'bot' | 'user'
  text: string
}

type TypingMessage = {
  kind: 'typing'
  id: string
}

type MiniProgramCard = {
  kind: 'miniProgram'
  id: string
  title: string
  subtitle: string
  buttonText: string
  target: 'questionnaire' | 'handoff'
}

type GroupInviteCard = {
  kind: 'groupInvite'
  id: string
  groupName: string
  description: string
}

type ProfileCardMessage = {
  kind: 'profileCard'
  id: string
  profile: UserProfile
}

type CandidateCardMessage = {
  kind: 'candidateCard'
  id: string
  candidate: CandidateProfile
}

type ChatItem = TextMessage | TypingMessage | MiniProgramCard | GroupInviteCard | ProfileCardMessage | CandidateCardMessage

type FlowStage =
  | 'collectingProfile'
  | 'awaitingProfileFormCompletion'
  | 'awaitingPrimaryGroupDecision'
  | 'awaitingCandidateDecision'
  | 'matchingLoop'

type UserProfile = {
  nickname: string
  identity: string
  city: string
  currentFocus: string
  seeking: string
  tags: string[]
  avatarUrl: string
}

type CandidateProfile = {
  name: string
  school: string
  studentId: string
  major: string
  grade: string
  focus: string
  bio: string
  tags: string[]
  avatarUrl: string
}

type ConversationItem = {
  id: string
  title: string
  subtitle: string
  badge: '企' | '群'
}

const DEFAULT_AVATAR = 'https://api.dicebear.com/9.x/thumbs/svg?seed=dadapal-user'
const BOT_NAME = 'AAA哒哒大王👑'
const CANDIDATE_AVATAR = 'https://api.dicebear.com/9.x/thumbs/svg?seed=dadapal-match'

const introMessage = `嗨嗨～我是 ${BOT_NAME} 👑

我专门帮上海交大、复旦大学、同济大学的同学们快速 connect。
不管你是新生、在读还是快毕业，我这边都有不少线索：同学、活动、组织、还有各种群。

简单来说，你告诉我一点关于你的情况，我会先帮你整理一张个人资料卡，再去帮你找合适的人和群。`

const introQuestion = `先从你开始吧。

你可以随便说说：你是谁、最近在忙什么、想认识什么样的人。

比如你可以这样说：
1. 我是交大大二，最近在做 AI + 设计项目，想认识一起做作品集的小伙伴
2. 我是复旦新生，刚来上海，想找周末一起探索城市的搭子
3. 我是同济研一，想认识对创业和产品感兴趣的同学

如果你现在懒得写，也可以直接回我：跳过`

const initialMessages: ChatItem[] = [
  {
    kind: 'text',
    id: 'welcome',
    sender: 'bot',
    text: introMessage,
  },
  {
    kind: 'text',
    id: 'intro-question',
    sender: 'bot',
    text: introQuestion,
  },
]

const firstGroupWelcomeMessages: ChatItem[] = [
  {
    kind: 'text',
    id: 'group-tip-1',
    sender: 'bot',
    text: '欢迎来到沪上校园生存指南群！你可以在这里问选课、社团、活动和住宿问题。',
  },
  {
    kind: 'text',
    id: 'group-tip-2',
    sender: 'bot',
    text: '今天群里比较热的是：交大机器人大赛组队、复旦城市散步局、同济设计工作坊。',
  },
]

const secondGroupWelcomeMessages: ChatItem[] = [
  {
    kind: 'text',
    id: 'second-group-tip-1',
    sender: 'bot',
    text: '欢迎来到沪上跨校项目组队群！这里主要是交大/复旦/同济跨校组队，适合找队友做比赛和项目。',
  },
]

function App() {
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatItem[]>>({
    'bot-main': initialMessages,
  })
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [flowStage, setFlowStage] = useState<FlowStage>('collectingProfile')
  const [showQuestionnaire, setShowQuestionnaire] = useState(false)
  const [profileTurns, setProfileTurns] = useState(0)
  const [profileSnippets, setProfileSnippets] = useState<string[]>([])
  const [conversations, setConversations] = useState<ConversationItem[]>([
    {
      id: 'bot-main',
      title: BOT_NAME,
      subtitle: '交大 · 复旦 · 同济',
      badge: '企',
    },
  ])
  const [activeConversationId, setActiveConversationId] = useState('bot-main')
  const [profileForm, setProfileForm] = useState<UserProfile>({
    nickname: '',
    identity: '',
    city: '',
    currentFocus: '',
    seeking: '',
    tags: [],
    avatarUrl: DEFAULT_AVATAR,
  })

  const userAvatar = useMemo(() => {
    return profileForm.avatarUrl || DEFAULT_AVATAR
  }, [profileForm.avatarUrl])

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations],
  )

  const inGroupConversation = activeConversation?.badge === '群'

  const messages = messagesByConversation[activeConversationId] ?? []

  const appendMessages = (conversationId: string, updater: (current: ChatItem[]) => ChatItem[]) => {
    setMessagesByConversation((current) => ({
      ...current,
      [conversationId]: updater(current[conversationId] ?? []),
    }))
  }

  const appendToActive = (updater: (current: ChatItem[]) => ChatItem[]) => {
    appendMessages(activeConversationId, updater)
  }

  const sendMessage = async (text: string) => {
    const cleanText = text.trim()
    if (!cleanText || isSending) return

    const userMessage: TextMessage = {
      kind: 'text',
      id: crypto.randomUUID(),
      sender: 'user',
      text: cleanText,
    }

    const messagesWithUser = [...messages, userMessage]
    appendToActive((current) => [...current, userMessage])
    setDraft('')
    setIsSending(true)

    if (flowStage === 'collectingProfile') {
      const nextSnippets = [...profileSnippets, cleanText]
      const nextTurns = profileTurns + 1
      setProfileTurns(nextTurns)
      setProfileSnippets(nextSnippets)

      const profileResult = await extractProfileWithBackend(nextSnippets, cleanText, profileForm, messagesWithUser, nextTurns)
      if (profileResult) {
        const parsedProfile = mapBackendProfileToUserProfile(profileResult.profile, profileForm)
        setProfileForm(parsedProfile)

        if (profileResult.is_sufficient) {
          await botTypingThenText(profileResult.assistant_reply || profileResult.natural_summary || buildProfileSummary(parsedProfile))
          appendToActive((current) => [
            ...current,
            {
              kind: 'miniProgram',
              id: crypto.randomUUID(),
              title: '哒哒校园档案小程序',
              subtitle: '先补完必填项，我们再继续往下匹配',
              buttonText: '打开小程序填写',
              target: 'questionnaire',
            },
          ])
          setFlowStage('awaitingProfileFormCompletion')
        } else {
          await botTypingThenText(profileResult.assistant_reply || profileResult.followup_question || nextProfileFollowupQuestion(parsedProfile, nextTurns))
        }
        setIsSending(false)
        return
      }

      await botTypingThenText('我这边暂时没连上理解服务，先别急着补信息，等我恢复一下再继续。')
      setIsSending(false)
      return
    }

    const apiReply = await sendToBackend(cleanText, flowStage)
    if (apiReply) {
      applyBackendReply(apiReply)
    } else {
      await botTypingThenText('收到，我继续帮你往下推进，有新线索第一时间告诉你。')
    }
    setIsSending(false)
  }

  const applyBackendReply = (reply: BackendChatReply) => {
    const action = reply.action ?? undefined
    const payload = reply.payload ?? {}

    if (action === 'show_group_invite' || action === 'show_second_group_invite') {
      const groupName = asString(payload.group_name) || '沪上校园生存指南群'
      const description = asString(payload.description) || '群里有校园答疑和活动信息。'
      appendToActive((current) => [
        ...current,
        {
          kind: 'groupInvite',
          id: crypto.randomUUID(),
          groupName,
          description,
        },
      ])
    }

    if (action === 'show_candidate_card') {
      appendToActive((current) => [
        ...current,
        {
          kind: 'candidateCard',
          id: crypto.randomUUID(),
          candidate: {
            name: asString(payload.name) || '林知夏',
            school: asString(payload.school) || '同济大学',
            studentId: asString(payload.student_id) || 'TJU-2024-1782',
            major: asString(payload.major) || '工业设计',
            grade: asString(payload.grade) || '大三',
            focus: asString(payload.focus) || 'AI + 交互设计作品集',
            bio: asString(payload.bio) || '最近在做校园服务机器人方向，想找跨校小伙伴一起冲比赛和作品集。',
            tags: asStringArray(payload.tags),
            avatarUrl: asString(payload.avatar_url) || CANDIDATE_AVATAR,
          },
        },
      ])
    }

    if (action === 'open_questionnaire') {
      appendToActive((current) => [
        ...current,
        {
          kind: 'miniProgram',
          id: crypto.randomUUID(),
          title: '哒哒校园档案小程序',
          subtitle: '先补完必填项，我们再继续往下匹配',
          buttonText: '打开小程序填写',
          target: 'questionnaire',
        },
      ])
    }

    appendToActive((current) => [
      ...current,
      {
        kind: 'text',
        id: crypto.randomUUID(),
        sender: 'bot',
        text: reply.bot_message.text,
      },
    ])

    const mappedStage = mapBackendStage(reply.next_stage)
    if (mappedStage) {
      setFlowStage(mappedStage)
    }
  }

  const joinGroupConversation = (groupName: string) => {
    const groupId = `group:${groupName}`
    const isFirstGroup = groupName === '沪上校园生存指南群'
    const welcomeMessages = isFirstGroup ? firstGroupWelcomeMessages : secondGroupWelcomeMessages
    setConversations((current) => {
      if (current.some((item) => item.id === groupId)) {
        return current
      }
      return [
        ...current,
        {
          id: groupId,
          title: groupName,
          subtitle: '群聊 · 已加入',
          badge: '群',
        },
      ]
    })
    appendMessages('bot-main', (current) => [
      ...current,
      {
        kind: 'text',
        id: crypto.randomUUID(),
        sender: 'bot',
        text: `已经把你拉进「${groupName}」啦，你可以在左边随时切回这个群聊。`,
      },
    ])
    setMessagesByConversation((current) => ({
      ...current,
      [groupId]: [...welcomeMessages],
    }))
    setActiveConversationId(groupId)

    if (isFirstGroup) {
      void revealCandidateAfterGroupJoin()
    } else {
      void revealIcebreakerAfterSecondGroup(groupId)
    }
  }

  const revealIcebreakerAfterSecondGroup = async (groupId: string) => {
    await sleep(2200)
    await botTypingThenText(
      '你们俩都是大三、都在做 AI 方向，林知夏在同济搞交互设计作品集，你在交大计算机转金融——方向挺互补的。认识一下吧，说不定能一起搞点事情～',
      1200,
      groupId,
    )
    await sleep(1800)
    await botTypingThenText(
      '你们都喜欢折腾项目，要不要一起去吃个饭聊聊？「四平路·老四川麻辣烫」离同济和交大都不远，他家是附近最麻辣的。用我们的码 DADAPAL5 可以抵 5 块钱，就当哒哒请你们的第一顿饭啦 🌶️',
      1200,
      groupId,
    )
    setFlowStage('matchingLoop')
  }

  const revealCandidateAfterGroupJoin = async () => {
    await sleep(2600)
    await botTypingThenText(
      '对了，我这边又帮你留意到一个人：同济大学大三的林知夏，她最近也在做 AI + 交互设计的作品集，想找跨校小伙伴一起冲比赛。要不要我帮你们加个好友认识一下？',
      1200,
      'bot-main',
    )
    appendMessages('bot-main', (current) => [
      ...current,
      {
        kind: 'candidateCard',
        id: crypto.randomUUID(),
        candidate: {
          name: '林知夏',
          school: '同济大学',
          studentId: 'TJU-2024-1782',
          major: '工业设计',
          grade: '大三',
          focus: 'AI + 交互设计作品集',
          bio: '最近在做校园服务机器人方向，想找跨校小伙伴一起冲比赛和作品集。',
          tags: ['AI', '交互设计', '跨校组队'],
          avatarUrl: CANDIDATE_AVATAR,
        },
      },
    ])
    setActiveConversationId('bot-main')
    setFlowStage('awaitingCandidateDecision')
  }

  const botTypingThenText = async (text: string, ms = 1200, conversationId?: string) => {
    const targetId = conversationId ?? activeConversationId
    const typingId = crypto.randomUUID()
    appendMessages(targetId, (current) => [...current, { kind: 'typing', id: typingId }])
    await sleep(ms)
    appendMessages(targetId, (current) => {
      const withoutTyping = current.filter((item) => item.id !== typingId)
      return [
        ...withoutTyping,
        { kind: 'text', id: crypto.randomUUID(), sender: 'bot', text },
      ]
    })
  }

  const onMiniProgramOpen = (target: MiniProgramCard['target']) => {
    if (target === 'questionnaire') {
      setShowQuestionnaire(true)
      return
    }
    appendToActive((current) => [
      ...current,
      {
        kind: 'text',
        id: crypto.randomUUID(),
        sender: 'bot',
        text: '对接信息已同步：微信号 AAA_dada_king，备注“哒哒牵线”我会优先通过你～',
      },
    ])
  }

  const onProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isProfileRequiredCompleted(profileForm)) {
      await botTypingThenText('还差几个必填项：身份、最近在做什么、想找什么。补齐后我再继续给你匹配。', 800)
      return
    }

    setShowQuestionnaire(false)

    appendToActive((current) => [
      ...current,
      {
        kind: 'profileCard',
        id: crypto.randomUUID(),
        profile: profileForm,
      },
      {
        kind: 'text',
        id: crypto.randomUUID(),
        sender: 'bot',
        text: '好啦，我已经了解得差不多了，这就开始帮你找。',
      },
    ])

    await sleep(2000)
    await botTypingThenText('我先给你一个几百人的群「沪上校园生存指南群」，你想先进去看看吗？')
    setFlowStage('awaitingPrimaryGroupDecision')
  }

  const onFieldChange = (field: keyof UserProfile, value: string) => {
    if (field === 'tags') {
      setProfileForm((current) => ({
        ...current,
        tags: value
          .split('、')
          .join(',')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      }))
      return
    }
    setProfileForm((current) => ({ ...current, [field]: value }))
  }

  const onAvatarUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProfileForm((current) => ({ ...current, avatarUrl: reader.result as string }))
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <main className="app-shell">
      <aside className="chat-list" aria-label="DadaPal conversations">
        <div className="profile-row">
          <strong>对话列表</strong>
        </div>
        {conversations.map((item) => (
          <button
            key={item.id}
            className={`conversation ${item.id === activeConversationId ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveConversationId(item.id)}
          >
            <span className={`bot-dot ${item.badge === '群' ? 'muted' : ''}`}>{item.badge}</span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </span>
          </button>
        ))}
      </aside>

      <section className="phone-frame" aria-label="Fake WeChat chat">
        <header className="chat-header">
          <span>{activeConversation?.title ?? BOT_NAME}</span>
          <small>{inGroupConversation ? '微信群聊' : '微信对话'}</small>
        </header>

        <div className="message-feed">
          {inGroupConversation ? (
            <>
              <div className="group-tip">你已加入群聊，先围观大家的分享吧～</div>
              {messages.map((message) => {
                if (message.kind === 'typing') {
                  return (
                    <div className="message-row bot" key={message.id}>
                      <div className="mini-avatar">群</div>
                      <div className="typing-bubble" aria-label="输入中">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )
                }
                if (message.kind === 'text') {
                  return (
                    <div className={`message-row ${message.sender}`} key={message.id}>
                      {message.sender === 'bot' ? <div className="mini-avatar">群</div> : null}
                      <p className="bubble">{message.text}</p>
                      {message.sender === 'user' ? <img className="user-avatar" alt="你的头像" src={userAvatar} /> : null}
                    </div>
                  )
                }
                return null
              })}
            </>
          ) : messages.map((message) => {
            if (message.kind === 'typing') {
              return (
                <div className="message-row bot" key={message.id}>
                  <div className="mini-avatar">A</div>
                  <div className="typing-bubble" aria-label="输入中">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )
            }

            if (message.kind === 'miniProgram') {
              return (
                <div className="message-row bot" key={message.id}>
                  <div className="mini-avatar">A</div>
                  <div className="program-card">
                    <strong>{message.title}</strong>
                    <p>{message.subtitle}</p>
                    <button type="button" onClick={() => onMiniProgramOpen(message.target)}>
                      {message.buttonText}
                    </button>
                  </div>
                </div>
              )
            }

            if (message.kind === 'groupInvite') {
              return (
                <div className="message-row bot" key={message.id}>
                  <div className="mini-avatar">A</div>
                  <div className="group-card">
                    <strong>{message.groupName}</strong>
                    <p>{message.description}</p>
                    <button type="button" onClick={() => joinGroupConversation(message.groupName)}>加入群聊</button>
                  </div>
                </div>
              )
            }

            if (message.kind === 'profileCard') {
              return (
                <div className="message-row bot" key={message.id}>
                  <div className="mini-avatar">A</div>
                  <article className="profile-card">
                    <img alt="用户头像" src={message.profile.avatarUrl || DEFAULT_AVATAR} />
                    <div>
                      <h3>{message.profile.nickname || '未命名同学'}</h3>
                      <p>{message.profile.identity || '身份待补充'}</p>
                      <p>{message.profile.city || '城市待补充'}</p>
                      <p>{message.profile.currentFocus || '近况待补充'}</p>
                      <p>{message.profile.seeking || '诉求待补充'}</p>
                      <div className="tags">
                        {(message.profile.tags.length ? message.profile.tags : ['待完善']).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  </article>
                </div>
              )
            }

            if (message.kind === 'candidateCard') {
              return (
                <div className="message-row bot" key={message.id}>
                  <div className="mini-avatar">A</div>
                  <article className="profile-card candidate-card">
                    <img alt="候选同学头像" src={message.candidate.avatarUrl || CANDIDATE_AVATAR} />
                    <div>
                      <h3>{message.candidate.name}</h3>
                      <p>{message.candidate.school} · {message.candidate.grade} · {message.candidate.major}</p>
                      <p>{message.candidate.focus}</p>
                      <p>{message.candidate.bio}</p>
                      <p className="student-id">学生证号：{message.candidate.studentId}</p>
                      <div className="tags">
                        {message.candidate.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  </article>
                </div>
              )
            }

            return (
              <div className={`message-row ${message.sender}`} key={message.id}>
                {message.sender === 'bot' ? <div className="mini-avatar">A</div> : null}
                <p className="bubble">{message.text}</p>
                {message.sender === 'user' ? <img className="user-avatar" alt="你的头像" src={userAvatar} /> : null}
              </div>
            )
          })}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            void sendMessage(draft)
          }}
        >
          <input
            aria-label="Message"
            placeholder="输入消息..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={inGroupConversation}
          />
          <button type="submit" disabled={isSending || inGroupConversation}>{isSending ? '发送中' : '发送'}</button>
        </form>
      </section>

      {showQuestionnaire && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowQuestionnaire(false)}>
          <form className="questionnaire" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} onSubmit={onProfileSubmit}>
            <button className="close" type="button" onClick={() => setShowQuestionnaire(false)}>
              关闭
            </button>
            <h2>哒哒校园档案小程序</h2>
            <label>
              昵称
              <input value={profileForm.nickname} onChange={(event) => onFieldChange('nickname', event.target.value)} />
            </label>
            <label>
              身份（年级/专业）
              <input value={profileForm.identity} onChange={(event) => onFieldChange('identity', event.target.value)} />
            </label>
            <label>
              城市
              <input value={profileForm.city} onChange={(event) => onFieldChange('city', event.target.value)} />
            </label>
            <label>
              最近在做什么
              <input value={profileForm.currentFocus} onChange={(event) => onFieldChange('currentFocus', event.target.value)} />
            </label>
            <label>
              想找什么
              <textarea value={profileForm.seeking} onChange={(event) => onFieldChange('seeking', event.target.value)} rows={2} />
            </label>
            <label>
              标签（逗号分隔）
              <input value={profileForm.tags.join(', ')} onChange={(event) => onFieldChange('tags', event.target.value)} />
            </label>
            <label>
              上传头像
              <input type="file" accept="image/*" onChange={onAvatarUpload} />
            </label>
            <div className="form-actions">
              <button type="submit">提交并生成至尊学生证</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

async function sendToBackend(text: string, stage: FlowStage): Promise<BackendChatReply | null> {
  let sessionId: string | null = getStoredApiSessionId()
  try {
    let response = await fetch(`${API_BASE_URL}/chat/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: sessionId,
        text,
        stage: mapFrontendStageToBackend(stage),
      }),
    })

    if (response.status === 404) {
      sessionId = await createBackendSession()
      if (!sessionId) return null
      response = await fetch(`${API_BASE_URL}/chat/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
          text,
          stage: mapFrontendStageToBackend(stage),
        }),
      })
    }

    if (!response.ok) return null
    const json = (await response.json()) as BackendChatReply
    return json
  } catch {
    return null
  }
}

async function extractProfileWithBackend(
  messages: string[],
  latestUserInput: string,
  currentProfile: UserProfile,
  recentMessages: ChatItem[],
  turnCount: number,
): Promise<BackendProfileExtractResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/profile/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        current_profile: mapUserProfileToBackendProfile(currentProfile),
        stage: 'collecting_profile',
        context: buildProfileConversationContext(latestUserInput, currentProfile, recentMessages, turnCount),
      }),
    })
    if (!response.ok) return null
    return (await response.json()) as BackendProfileExtractResponse
  } catch {
    return null
  }
}

function buildProfileConversationContext(
  latestUserInput: string,
  currentProfile: UserProfile,
  recentMessages: ChatItem[],
  turnCount: number,
): {
  stage: string
  stage_goal: string
  latest_user_input: string
  recent_turns: BackendConversationTurn[]
  turn_count: number
  known_profile: BackendProfileDraft
} {
  return {
    stage: 'collecting_profile',
    stage_goal: '获得足够清晰的用户画像和连接需求；如果用户拒绝、偏题或提问，也要自然解释并拉回这个目标。',
    latest_user_input: latestUserInput,
    recent_turns: recentMessages
      .filter((message): message is TextMessage => message.kind === 'text')
      .slice(-8)
      .map((message) => ({
        role: message.sender === 'user' ? 'user' : 'agent',
        text: message.text,
        stage: 'collecting_profile',
      })),
    turn_count: turnCount,
    known_profile: mapUserProfileToBackendProfile(currentProfile),
  }
}

function mapUserProfileToBackendProfile(profile: UserProfile): BackendProfileDraft {
  const parts = profile.identity.split(' · ').map((part) => part.trim()).filter(Boolean)
  const grade = parts.find((part) => /^(大一|大二|大三|大四|研一|研二|新生|毕业)$/.test(part)) ?? ''
  const major = parts.find((part) => part !== grade && !isKnownSchool(part)) ?? ''
  const school = parts.find(isKnownSchool) ?? ''

  return {
    nickname: profile.nickname,
    school,
    grade,
    major,
    city: profile.city,
    current_focus: profile.currentFocus,
    seeking: profile.seeking,
    tags: profile.tags,
    confidence_notes: '',
  }
}

function mapBackendProfileToUserProfile(profile: BackendProfileDraft, current: UserProfile): UserProfile {
  const identity = [profile.school, profile.grade, profile.major].filter(Boolean).join(' · ')
  return {
    nickname: profile.nickname || current.nickname,
    identity: identity || current.identity,
    city: profile.city || current.city,
    currentFocus: profile.current_focus || current.currentFocus,
    seeking: profile.seeking || current.seeking,
    tags: profile.tags.length ? profile.tags : current.tags,
    avatarUrl: current.avatarUrl || DEFAULT_AVATAR,
  }
}

function isKnownSchool(value: string): boolean {
  return ['上海交大', '上海交通大学', '复旦', '复旦大学', '同济', '同济大学'].includes(value)
}

function getStoredApiSessionId(): string {
  const existing = localStorage.getItem('dadapal.apiSessionId')
  if (existing) return existing
  return `local-${crypto.randomUUID()}`
}

async function createBackendSession(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        display_name: 'DadaPal Web User',
      }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { id?: string }
    if (!data.id) return null
    localStorage.setItem('dadapal.apiSessionId', data.id)
    return data.id
  } catch {
    return null
  }
}

function mapFrontendStageToBackend(stage: FlowStage): string {
  if (stage === 'collectingProfile') return 'collecting_profile'
  if (stage === 'awaitingProfileFormCompletion') return 'awaiting_profile_form_completion'
  if (stage === 'awaitingPrimaryGroupDecision') return 'suggest_first_group'
  if (stage === 'awaitingCandidateDecision') return 'ask_contact_permission'
  if (stage === 'matchingLoop') return 'freeform_followup'
  return 'intro'
}

function mapBackendStage(stage: string | null | undefined): FlowStage | null {
  if (stage === 'collecting_profile') return 'collectingProfile'
  if (stage === 'awaiting_profile_form_completion') return 'awaitingProfileFormCompletion'
  if (stage === 'suggest_first_group') return 'awaitingPrimaryGroupDecision'
  if (stage === 'recommend_candidate' || stage === 'ask_contact_permission') return 'awaitingCandidateDecision'
  if (stage === 'freeform_followup' || stage === 'suggest_second_group') return 'matchingLoop'
  return null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return ['待完善']
  const mapped = value.filter((item): item is string => typeof item === 'string')
  return mapped.length ? mapped : ['待完善']
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function nextProfileFollowupQuestion(profile: UserProfile, turns: number): string {
  if (!profile.identity) {
    return '我先确认一下你的基础信息：你现在是哪个学校、什么年级或专业？'
  }
  if (!profile.currentFocus) {
    return '了解。那你最近主要在忙什么？课程、项目、比赛、社团都可以。'
  }
  if (!profile.seeking) {
    return '最后一个关键点：你现在最想认识什么类型的人，或者最想连接什么资源？'
  }
  if (turns < 3) {
    return '我再补一个小问题：你更偏好同校、跨校，还是活动型连接？'
  }
  return '这些信息已经很有帮助了，我先总结一下，你看我理解得准不准。'
}

function buildProfileSummary(profile: UserProfile): string {
  const identity = profile.identity || '身份信息待补充'
  const city = profile.city ? `，在${profile.city}` : ''
  const focus = profile.currentFocus ? `，最近主要在${profile.currentFocus}` : ''
  const seeking = profile.seeking ? `，现在想连接${profile.seeking}` : ''

  return `我先确认一下我有没有理解对：你现在是${identity}${city}${focus}${seeking}。如果这个方向没偏，我就按这个去帮你找合适的人和群。`
}

function isProfileRequiredCompleted(profile: UserProfile): boolean {
  return Boolean(profile.identity.trim() && profile.currentFocus.trim() && profile.seeking.trim())
}

export default App
