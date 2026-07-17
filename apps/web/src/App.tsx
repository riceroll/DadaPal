import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'
import { askOpenRouter, unlockOpenRouterKey } from './aiAccess'

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

const AVATAR_BASE = `${import.meta.env.BASE_URL}avatars/`
const DEFAULT_AVATAR = `${AVATAR_BASE}user-default.svg`
const BOT_NAME = 'AAA哒哒大王👑'
const BOT_AVATAR = `${AVATAR_BASE}dada-king.svg`
const CANDIDATE_AVATAR = `${AVATAR_BASE}match-default.svg`

const introMessage = `嗨嗨～我是 ${BOT_NAME} 👑

我专门帮上海交大、复旦大学、同济大学的同学们快速 connect。
不管你是新生、在读还是快毕业，我这边都有不少线索：同学、活动、组织、还有各种群。

简单来说，你告诉我一点关于你的情况，我会先帮你整理一张个人资料卡，再去帮你找合适的人和群。`

const introQuestion = `先从你开始吧 ✦

你可以随便告诉我三件事：
• 你是谁 / 在哪里上学
• 最近在忙什么
• 想认识什么样的人

可以直接照着这样发：

① 交大大二，最近做 AI + 设计项目，想找一起做作品集的小伙伴

② 复旦新生，刚来上海，想找周末一起探索城市的搭子

③ 同济研一，想认识对创业和产品感兴趣的同学

不想写也没关系，直接回复「跳过」就好。`

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

function buildGroupName(profile: UserProfile, followUp: boolean) {
  const focus = (profile.currentFocus || profile.seeking || '校园同频').replace(/[，。；;！!？?].*$/, '').slice(0, 12)
  return followUp ? `${focus} 深聊组队群` : `${focus} 搭子交流组`
}

function buildCandidateFromProfile(profile: UserProfile): CandidateProfile {
  const focus = profile.currentFocus || profile.seeking || '校园项目与兴趣探索'
  const school = profile.identity.includes('复旦') ? '同济大学' : profile.identity.includes('同济') ? '复旦大学' : '同济大学'
  const identityParts = profile.identity.split('·').map((part) => part.trim())
  return {
    name: '林知夏',
    school,
    studentId: 'DADA-LX21',
    major: identityParts.find((part) => part && !isKnownSchool(part) && !/大[一二三四]|研[一二三]|新生/.test(part)) || '交互设计',
    grade: profile.identity.match(/大[一二三四]|研[一二三]|新生/)?.[0] || '大三',
    focus: `${focus} · 想找能一起启动的小伙伴`,
    bio: `最近也在关注「${focus}」，更喜欢从一次轻松的讨论或小任务开始，看看能不能一起做下去。`,
    tags: ['同频方向', '跨校连接', '愿意行动'],
    avatarUrl: CANDIDATE_AVATAR,
  }
}

function buildGroupIcebreaker(profile: UserProfile, candidate: CandidateProfile) {
  const sharedFocus = profile.currentFocus || profile.seeking || candidate.focus.replace(/·.*$/, '').trim() || '校园里的新想法'
  const userSchool = profile.identity.split('·').map((part) => part.trim()).find(isKnownSchool) || '你的学校'
  const schoolConnection = userSchool === candidate.school ? `你们都在${userSchool}` : `你在${userSchool}，${candidate.name}在${candidate.school}`

  return `破冰一下 👋\n\n你们的共同点：都在关注「${sharedFocus}」，而且都更愿意从一个小行动开始看看能不能做下去。${schoolConnection}，跨校交流也许能带来不同视角。\n\n给你们的破冰题：如果这周只留出 90 分钟来推进「${sharedFocus}」，你最想先做哪一件具体的小事？请两个人各自回答一下吧～`
}

function nextProfileRefinementQuestion(profile: UserProfile, refinementTurn: number) {
  if (!profile.city) return '最后补一个小坐标：你现在主要在上海哪个校区或区域活动？这样我给你找活动和搭子会更顺路。'
  if (refinementTurn === 0) return `为了把匹配再收准一点：做「${profile.currentFocus || '这件事'}」时，你更希望认识哪种搭子？比如能一起做项目、互相督促，还是交流经验的人？`
  return '再问一个轻量问题：你平时比较方便的时间是什么时候？例如工作日晚上、周末下午，或线上也可以。'
}

function sanitizeWeChatText(text: string) {
  return text.replace(/\*\*/g, '')
}

function App() {
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatItem[]>>({
    'bot-main': initialMessages,
  })
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [flowStage, setFlowStage] = useState<FlowStage>('collectingProfile')
  const [showQuestionnaire, setShowQuestionnaire] = useState(false)
  const [profileTurns, setProfileTurns] = useState(0)
  const [profileRefinementTurns, setProfileRefinementTurns] = useState(0)
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
  const [showConversationList, setShowConversationList] = useState(false)
  const [profileForm, setProfileForm] = useState<UserProfile>({
    nickname: '',
    identity: '',
    city: '',
    currentFocus: '',
    seeking: '',
    tags: [],
    avatarUrl: DEFAULT_AVATAR,
  })
  const [aiKey, setAiKey] = useState<string | null>(null)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [isUnlocking, setIsUnlocking] = useState(false)
  const messageFeedRef = useRef<HTMLDivElement>(null)
  const candidateShownRef = useRef(false)

  const userAvatar = useMemo(() => {
    return profileForm.avatarUrl || DEFAULT_AVATAR
  }, [profileForm.avatarUrl])

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations],
  )

  const inGroupConversation = activeConversation?.badge === '群'

  const messages = messagesByConversation[activeConversationId] ?? []
  const isBotTyping = !inGroupConversation && (isSending || messages.some((message) => message.kind === 'typing'))

  useEffect(() => {
    messageFeedRef.current?.scrollTo({ top: messageFeedRef.current.scrollHeight, behavior: 'smooth' })
  }, [activeConversationId, messages.length])

  const appendMessages = (conversationId: string, updater: (current: ChatItem[]) => ChatItem[]) => {
    setMessagesByConversation((current) => ({
      ...current,
      [conversationId]: updater(current[conversationId] ?? []),
    }))
  }

  const appendToActive = (updater: (current: ChatItem[]) => ChatItem[]) => {
    appendMessages(activeConversationId, updater)
  }

  const unlockAi = async () => {
    if (!unlockPassword || isUnlocking) return
    setIsUnlocking(true)
    setUnlockError('')
    try {
      setAiKey(await unlockOpenRouterKey(unlockPassword))
      setUnlockPassword('')
    } catch {
      setUnlockError('密码不正确，请再试一次。')
    } finally {
      setIsUnlocking(false)
    }
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

    if (flowStage === 'awaitingCandidateDecision') {
      await handleCandidateDecision(cleanText)
      setIsSending(false)
      return
    }

    if (flowStage === 'collectingProfile') {
      const nextSnippets = [...profileSnippets, cleanText]
      const nextTurns = profileTurns + 1
      setProfileTurns(nextTurns)
      setProfileSnippets(nextSnippets)

      const profileResult = await extractProfileWithBackend(nextSnippets, cleanText, profileForm, messagesWithUser, nextTurns, aiKey)
      if (profileResult) {
        const parsedProfile = mapBackendProfileToUserProfile(profileResult.profile, profileForm)
        setProfileForm(parsedProfile)

        const hasCoreProfile = isProfileRequiredCompleted(parsedProfile)
        if (hasCoreProfile && profileRefinementTurns < 2) {
          setProfileRefinementTurns((current) => current + 1)
          await botTypingThenText(nextProfileRefinementQuestion(parsedProfile, profileRefinementTurns), 700)
          setIsSending(false)
          return
        }

        if (profileResult.is_sufficient || hasCoreProfile) {
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

    const apiReply = await sendToBackend(cleanText, flowStage, aiKey, messagesWithUser, profileForm)
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
      if (!candidateShownRef.current) {
        candidateShownRef.current = true
        appendToActive((current) => [
        ...current,
        {
          kind: 'candidateCard',
          id: crypto.randomUUID(),
          candidate: {
            name: asString(payload.name) || buildCandidateFromProfile(profileForm).name,
            school: asString(payload.school) || buildCandidateFromProfile(profileForm).school,
            studentId: asString(payload.student_id) || 'TJU-2024-1782',
            major: asString(payload.major) || buildCandidateFromProfile(profileForm).major,
            grade: asString(payload.grade) || buildCandidateFromProfile(profileForm).grade,
            focus: asString(payload.focus) || buildCandidateFromProfile(profileForm).focus,
            bio: asString(payload.bio) || buildCandidateFromProfile(profileForm).bio,
            tags: asStringArray(payload.tags).length ? asStringArray(payload.tags) : buildCandidateFromProfile(profileForm).tags,
            avatarUrl: asString(payload.avatar_url) || CANDIDATE_AVATAR,
          },
        },
        ])
      }
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
        text: sanitizeWeChatText(reply.bot_message.text),
      },
    ])

    const mappedStage = mapBackendStage(reply.next_stage)
    if (mappedStage) {
      setFlowStage(mappedStage)
    }
  }

  const joinGroupConversation = (groupName: string) => {
    const groupId = `group:${groupName}`
    if (conversations.some((item) => item.id === groupId)) {
      setActiveConversationId(groupId)
      return
    }
    const isFirstGroup = !candidateShownRef.current
    const direction = profileForm.currentFocus || profileForm.seeking || '校园同频连接'
    const welcomeMessages: ChatItem[] = [{ kind: 'text', id: crypto.randomUUID(), sender: 'bot', text: `欢迎来到「${groupName}」！这里围绕${direction}交流和组队，先看看大家正在做什么。` }]
    setConversations((current) => {
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
      candidateShownRef.current = true
      void revealCandidateAfterGroupJoin()
    } else {
      void revealIcebreakerAfterSecondGroup(groupId)
    }
  }

  const revealIcebreakerAfterSecondGroup = async (groupId: string) => {
    const candidate = buildCandidateFromProfile(profileForm)
    await sleep(2200)
    await botTypingThenText(
      `你和${candidate.name}都在关注「${profileForm.currentFocus || profileForm.seeking || '这件事'}」，方向挺互补的。认识一下吧，说不定能一起把它推进。`,
      1200,
      groupId,
    )
    await sleep(1800)
    await botTypingThenText(
      '可以先约一次低压力的线上聊聊或校园散步：把想做的事拆成一个 30 分钟就能开始的小目标，再决定要不要继续组队。',
      1200,
      groupId,
    )
    setFlowStage('matchingLoop')
  }

  const revealCandidateAfterGroupJoin = async () => {
    const candidate = buildCandidateFromProfile(profileForm)
    await sleep(2600)
    await botTypingThenText(
      `对了，我这边留意到${candidate.school}${candidate.grade}的${candidate.name}，Ta 最近也在做「${candidate.focus}」。要不要先看看 Ta 的名片，再决定要不要认识？`,
      1200,
      'bot-main',
    )
    appendMessages('bot-main', (current) => [
      ...current,
      {
        kind: 'candidateCard',
        id: crypto.randomUUID(),
        candidate,
      },
    ])
    setActiveConversationId('bot-main')
    setFlowStage('awaitingCandidateDecision')
  }

  const handleCandidateDecision = async (text: string) => {
    const candidate = buildCandidateFromProfile(profileForm)
    const normalized = text.replace(/\s/g, '')
    const declines = /^(不|不要|不了|暂时不|先不了|算了|不用|没兴趣)/
    const accepts = /^(要|想|可以|好|好的|行|愿意|牵线|认识|联系|加)/

    if (declines.test(normalized)) {
      await botTypingThenText(`没问题，我先不打扰你和${candidate.name}。之后想认识其他同学，随时和我说。`, 700)
      setFlowStage('matchingLoop')
      return
    }

    if (accepts.test(normalized)) {
      await botTypingThenText(`好呀，我先帮你向${candidate.name}发出认识邀请。对方同意后，我会把你们拉进一个临时小群，方便先聊聊。`, 700)
      appendToActive((current) => [
        ...current,
        {
          kind: 'miniProgram',
          id: crypto.randomUUID(),
          title: `和 ${candidate.name} 认识一下`,
          subtitle: '哒哒会先建一个临时小群，方便你们自然地打个招呼。',
          buttonText: '拉进临时小群',
          target: 'handoff',
        },
      ])
      setFlowStage('matchingLoop')
      return
    }

    await botTypingThenText(`名片已经在上面啦。你想让我帮你牵线认识${candidate.name}，还是先继续看看其他同学或群？`, 650)
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
        { kind: 'text', id: crypto.randomUUID(), sender: 'bot', text: sanitizeWeChatText(text) },
      ]
    })
  }

  const onMiniProgramOpen = (target: MiniProgramCard['target']) => {
    if (target === 'questionnaire') {
      setShowQuestionnaire(true)
      return
    }
    const candidate = buildCandidateFromProfile(profileForm)
    const groupName = `哒哒牵线 · 你和${candidate.name}`
    const groupId = `group:${groupName}`

    if (!conversations.some((item) => item.id === groupId)) {
      setConversations((current) => [
        ...current,
        { id: groupId, title: groupName, subtitle: '临时牵线群 · 已加入', badge: '群' },
      ])
      setMessagesByConversation((current) => ({
        ...current,
        [groupId]: [
          {
            kind: 'text',
            id: crypto.randomUUID(),
            sender: 'bot',
            text: `欢迎来到临时牵线群！我把你和${candidate.name}拉进来啦。`,
          },
          {
            kind: 'text',
            id: crypto.randomUUID(),
            sender: 'bot',
            text: buildGroupIcebreaker(profileForm, candidate),
          },
        ],
      }))
    }
    setActiveConversationId(groupId)
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
    const groupName = buildGroupName(profileForm, false)
    await botTypingThenText(`我先给你一个围绕「${profileForm.currentFocus || profileForm.seeking || '校园同频'}」的群「${groupName}」，你想先进去看看吗？`)
    appendToActive((current) => [...current, { kind: 'groupInvite', id: crypto.randomUUID(), groupName, description: `围绕${profileForm.currentFocus || profileForm.seeking || '校园同频'}交流、找搭子和约活动。` }])
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
    <main className={`app-shell ${showConversationList ? 'show-conversation-list' : ''}`}>
      <aside className="chat-list" aria-label="DadaPal conversations">
        <div className="profile-row">
          <strong>微信</strong>
        </div>
        {conversations.map((item) => (
          <button
            key={item.id}
            className={`conversation ${item.id === activeConversationId ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setActiveConversationId(item.id)
              setShowConversationList(false)
            }}
          >
            {item.badge === '群'
              ? <span className="bot-dot muted">群</span>
              : <img className="bot-dot bot-avatar" alt="哒哒大王头像" src={BOT_AVATAR} />}
            <span>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </span>
          </button>
        ))}
      </aside>

      <section className="phone-frame" aria-label="Fake WeChat chat">
        <div className="main-statusbar" aria-hidden="true">
          <span>9:41</span>
          <span>▮▮▮ 5G ▰</span>
        </div>
        <header className="chat-header">
          <div className="main-header-title">
            <button className="conversation-back" type="button" onClick={() => setShowConversationList(true)} aria-label="返回对话列表">‹</button>
            {inGroupConversation
              ? <span className="mini-avatar group-avatar">群</span>
              : <img className="mini-avatar bot-avatar" alt="哒哒大王头像" src={BOT_AVATAR} />}
            <div><strong>{isBotTyping ? '对方正在输入…' : activeConversation?.title ?? BOT_NAME}</strong><small>{inGroupConversation ? '微信群聊' : '@搭搭社交'}</small></div>
          </div>
          {!inGroupConversation && <span className="main-live">在线</span>}
        </header>

        <div className="message-feed" ref={messageFeedRef}>
          {inGroupConversation ? (
            <>
              <div className="group-tip">你已加入群聊，先围观大家的分享吧～</div>
              {messages.map((message) => {
                if (message.kind === 'typing') return null
                if (message.kind === 'text') {
                  return (
                    <div className={`message-row ${message.sender}`} key={message.id}>
                      {message.sender === 'bot' ? <div className="mini-avatar">群</div> : null}
                      <p className="bubble">{message.text}</p>
                      {message.sender === 'user' ? <img className="user-avatar" alt="你的头像" src={userAvatar} onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR }} /> : null}
                    </div>
                  )
                }
                return null
              })}
            </>
          ) : messages.map((message) => {
            if (message.kind === 'typing') return null

            if (message.kind === 'miniProgram') {
              return (
                <div className="message-row bot" key={message.id}>
                  <img className="mini-avatar bot-avatar" alt="哒哒大王头像" src={BOT_AVATAR} />
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
                  <img className="mini-avatar bot-avatar" alt="哒哒大王头像" src={BOT_AVATAR} />
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
                  <img className="mini-avatar bot-avatar" alt="哒哒大王头像" src={BOT_AVATAR} />
                  <article className="profile-card">
                    <img alt="用户头像" src={message.profile.avatarUrl || DEFAULT_AVATAR} onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR }} />
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
                  <img className="mini-avatar bot-avatar" alt="哒哒大王头像" src={BOT_AVATAR} />
                  <article className="profile-card candidate-card">
                    <img alt="候选同学头像" src={message.candidate.avatarUrl || CANDIDATE_AVATAR} onError={(event) => { event.currentTarget.src = CANDIDATE_AVATAR }} />
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
                {message.sender === 'bot' ? <img className="mini-avatar bot-avatar" alt="哒哒大王头像" src={BOT_AVATAR} /> : null}
                <p className="bubble">{message.text}</p>
                {message.sender === 'user' ? <img className="user-avatar" alt="你的头像" src={userAvatar} onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR }} /> : null}
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
          <button type="submit" disabled={isSending || inGroupConversation}>发送</button>
        </form>
        <div className="main-home-indicator" aria-hidden="true" />
      </section>

      {showQuestionnaire && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowQuestionnaire(false)}>
          <form className="questionnaire" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} onSubmit={onProfileSubmit}>
            <header className="questionnaire-header">
              <div><span>搭搭社交 · 小程序</span><h2>我的校园连接卡</h2><p>补全后，哒哒会按你的方向找人、找群和安排破冰。</p></div>
              <button className="close" type="button" onClick={() => setShowQuestionnaire(false)} aria-label="关闭档案">×</button>
            </header>
            <div className="questionnaire-preview">
              <img src={userAvatar} alt="你的头像预览" onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR }} />
              <div><small>校园连接档案</small><strong>{profileForm.nickname || '未命名同学'}</strong><p>{profileForm.identity || '填写年级和专业'}</p></div>
              <b>完成度 {isProfileRequiredCompleted(profileForm) ? '100%' : '进行中'}</b>
            </div>
            <div className="questionnaire-section"><h3>基本坐标 <small>必填</small></h3><div className="questionnaire-grid">
              <label>昵称<input placeholder="怎么称呼你" value={profileForm.nickname} onChange={(event) => onFieldChange('nickname', event.target.value)} /></label>
              <label>所在城市<input placeholder="例如：上海" value={profileForm.city} onChange={(event) => onFieldChange('city', event.target.value)} /></label>
              <label className="full-width">身份（学校 · 年级 · 专业）<input placeholder="例如：上海交大 · 大三 · 计算机" value={profileForm.identity} onChange={(event) => onFieldChange('identity', event.target.value)} /></label>
            </div></div>
            <div className="questionnaire-section"><h3>这次想连接什么 <small>必填</small></h3><div className="questionnaire-grid">
              <label className="full-width">最近在做什么<input placeholder="例如：准备 AI 实习、做项目、探索校园" value={profileForm.currentFocus} onChange={(event) => onFieldChange('currentFocus', event.target.value)} /></label>
              <label className="full-width">想认识什么样的人<textarea placeholder="说说希望对方能和你一起做什么" value={profileForm.seeking} onChange={(event) => onFieldChange('seeking', event.target.value)} rows={3} /></label>
            </div></div>
            <div className="questionnaire-section optional"><h3>让匹配更准 <small>选填</small></h3><div className="questionnaire-grid">
              <label>兴趣标签<input placeholder="AI、跑步、创业（用逗号分隔）" value={profileForm.tags.join(', ')} onChange={(event) => onFieldChange('tags', event.target.value)} /></label>
              <label>头像<input type="file" accept="image/*" onChange={onAvatarUpload} /></label>
            </div></div>
            <div className="form-actions">
              <button type="submit">保存连接卡，开始找搭子 <span>→</span></button>
              <p>仅用于本次体验中的匹配与破冰，不会公开展示。</p>
            </div>
          </form>
        </div>
      )}
      {!aiKey && <div className="ai-unlock-overlay" role="dialog" aria-modal="true" aria-label="解锁 AI 功能"><section className="ai-unlock-card"><span className="ai-unlock-mark">搭</span><h1>解锁哒哒 AI</h1><p>输入访问密码后，哒哒会直接理解你的介绍、补全校园档案并继续找人找群。密钥只保留在本次页面内存中。</p><form onSubmit={(event) => { event.preventDefault(); void unlockAi() }}><input type="password" autoFocus value={unlockPassword} onChange={(event) => setUnlockPassword(event.target.value)} placeholder="访问密码" /><button type="submit" disabled={isUnlocking}>{isUnlocking ? '正在解锁…' : '解锁并开始'}</button></form>{unlockError && <small>{unlockError}</small>}</section></div>}
    </main>
  )
}

async function sendToBackend(text: string, stage: FlowStage, apiKey: string | null, recentMessages: ChatItem[], profile: UserProfile): Promise<BackendChatReply | null> {
  if (apiKey) {
    try {
      return await askOpenRouter<BackendChatReply>(apiKey, buildChatPrompt(text, stage, recentMessages, profile), 650)
    } catch {
      // Keep a local-backend fallback for development environments.
    }
  }
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
  apiKey: string | null,
): Promise<BackendProfileExtractResponse | null> {
  if (apiKey) {
    try {
      return await askOpenRouter<BackendProfileExtractResponse>(apiKey, buildProfilePrompt(messages, latestUserInput, currentProfile, recentMessages, turnCount), 850)
    } catch {
      // Keep a local-backend fallback for development environments.
    }
  }
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

function buildProfilePrompt(
  snippets: string[],
  latestUserInput: string,
  currentProfile: UserProfile,
  recentMessages: ChatItem[],
  turnCount: number,
): string {
  const context = buildProfileConversationContext(latestUserInput, currentProfile, recentMessages, turnCount)
  return `你是 AAA哒哒大王，一个微信语气、温柔主动的校园连接助手。根据用户的自然语言介绍提取校园档案；不要编造学校、身份或个人经历。信息不足时只追问一个最关键问题。严格输出 JSON，不要 Markdown，不要额外字段：{"profile":{"nickname":"","school":"","grade":"","major":"","city":"","current_focus":"","seeking":"","tags":[],"confidence_notes":""},"missing_fields":[],"is_sufficient":false,"followup_question":"","natural_summary":"","assistant_reply":""}。当昵称、学校/城市、近况和想找什么基本清楚时 is_sufficient 为 true。\n已收集内容：${snippets.join('\n')}\n上下文：${JSON.stringify(context)}`
}

function buildChatPrompt(text: string, stage: FlowStage, history: ChatItem[], profile: UserProfile): string {
  const recentTurns = history.filter((message): message is TextMessage => message.kind === 'text').slice(-8).map((message) => `${message.sender === 'user' ? '用户' : '哒哒'}：${message.text}`).join('\n')
  return `你是 AAA哒哒大王，微信语气、温柔主动的校园连接助手。根据对话阶段和新消息推进找人找群流程，不要编造真实学生或保证成功。严格输出 JSON，不要 Markdown：{"bot_message":{"text":""},"action":null,"payload":{},"next_stage":null}。action 仅可为 null、show_group_invite、show_second_group_invite、show_candidate_card、open_questionnaire。当用户在 awaitingPrimaryGroupDecision 明确同意进群时，用 show_group_invite，payload 提供 group_name 和 description；其他情况用 null。next_stage 仅可为 null、collecting_profile、awaiting_profile_form_completion、awaiting_primary_group_decision、awaiting_candidate_decision、matching_loop。\n阶段：${stage}\n档案：${JSON.stringify(profile)}\n最近对话：${recentTurns}\n新消息：${text}`
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
