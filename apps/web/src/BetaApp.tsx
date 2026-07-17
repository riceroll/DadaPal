import { useEffect, useMemo, useRef, useState } from 'react'
import { askOpenRouter, unlockOpenRouterKey } from './aiAccess'
const DADA_AVATAR = `${import.meta.env.BASE_URL}avatars/dada-king.svg`

type Feature = 'profile-card' | 'match' | 'cbti' | 'tarot' | 'compatibility' | 'answer-book'
type Panel = Exclude<Feature, 'answer-book'> | null
type Sender = 'dada' | 'user'

type BetaConversation = {
  id: string
  title: string
  subtitle: string
  kind: 'dada' | 'group'
  badge: '搭' | '群'
  isNew?: boolean
}

type BetaMessage =
  | { id: string; kind: 'text'; sender: Sender; text: string }
  | { id: string; kind: 'feature'; feature: Feature }
  | { id: string; kind: 'profile-card'; profile: CampusProfile }
  | { id: string; kind: 'candidate-card'; profile: CampusProfile }
  | { id: string; kind: 'tarot-reading'; cards: DrawnTarotCard[]; interpretation: string }

type CampusProfile = {
  nickname: string
  school: string
  college: string
  major: string
  grade: string
  interests: string
  sbtiCode: string
  roleName: string
  tags: string[]
  personaReport?: string
  dadaId: string
}

type TarotCard = {
  title: string
  art: string
  line: string
  tone: 'lemon' | 'mint' | 'coral'
}

type DrawnTarotCard = TarotCard & { reversed: boolean }

type TarotAnalysis = {
  surface: string
  depth: string
  structure: string
  guidance: string
}

type CompatibilityAnalysis = {
  profile: string
  resonance: string
  rhythm: string
  guidance: string
}

const STORAGE_KEY = 'dadapal-beta-v2'

const featureCopy: Record<Feature, { icon: string; title: string; subtitle: string; button: string }> = {
  'profile-card': { icon: '▣', title: '我的校园名片', subtitle: '填写校园坐标，生成可分享的个人名片', button: '打开小程序' },
  match: { icon: '✦', title: '找个搭子', subtitle: '说说你在做什么，想遇见怎样的搭子', button: '开始找搭子' },
  cbti: { icon: '▦', title: '校园 CBTI', subtitle: '做 6 道题，生成你的校园社交人格卡', button: '去做 CBTI' },
  tarot: { icon: '☾', title: '搭罗牌', subtitle: '问一个大学生活的问题，抽三张牌', button: '抽一把牌' },
  compatibility: { icon: '∞', title: '好友契合度', subtitle: '输入朋友 DADA-ID，解锁你们的搭子关系图', button: '测契合度' },
  'answer-book': { icon: '✎', title: '校园答案之书', subtitle: '正在装订中，下一轮 Beta 开放', button: '即将解锁' },
}

const initialMessages: BetaMessage[] = [
  {
    id: 'beta-welcome',
    kind: 'text',
    sender: 'dada',
    text: '嗨嗨，我是哒哒大王的 Beta 版 👑 这里可以找搭子、测你和朋友的契合度，也能直接玩一把搭罗牌。我们先从你的校园名片开始：它会帮我更懂你，也会解锁后面的 CBTI。',
  },
  { id: 'beta-profile-card', kind: 'feature', feature: 'profile-card' },
]

type CbtiAxis = 'E' | 'R' | 'X' | 'S' | 'A' | 'F' | 'C' | 'I' | 'N' | 'P'
type CbtiQuestion = { question: string; options: readonly [readonly [string, CbtiAxis], readonly [string, CbtiAxis]] }

const questions: readonly CbtiQuestion[] = [
  { question: '到一个谁都不熟的活动现场，你更自然会？', options: [['先和附近的人打招呼，边聊边找感觉', 'E'], ['先观察场子和话题，找到舒服的切口再加入', 'R']] },
  { question: '一天被密集社交填满后，你通常更需要？', options: [['独处一会儿，把今天的信息整理回自己', 'R'], ['再和熟人吃点东西，把兴奋慢慢收住', 'E']] },
  { question: '小组第一次开会，你更容易承担？', options: [['让大家先说起来、彼此认识起来', 'E'], ['听完不同意见后，指出关键分歧', 'R']] },
  { question: '遇到一门陌生选修课，你更倾向于？', options: [['先去试听，感受一下再决定', 'X'], ['先看课程大纲、作业和评分方式', 'S']] },
  { question: '计划周末时，哪种安排更让你期待？', options: [['提前约好时间地点，心里更踏实', 'S'], ['留一点空白，临时发现什么就去做什么', 'X']] },
  { question: '一个点子还不成熟时，你会？', options: [['先抛出去试试反馈，边做边长出来', 'X'], ['先把路径想清楚，确认可行再启动', 'S']] },
  { question: '项目出现小问题时，你更常先？', options: [['立刻做一个小测试，把问题往前推', 'A'], ['停一下复盘原因，避免下一步走偏', 'F']] },
  { question: '朋友说“我不知道怎么办”时，你更像？', options: [['先帮 TA 把感受、顾虑和选择理清', 'F'], ['陪 TA 列出一个今天就能做的动作', 'A']] },
  { question: '面对截止日期，你通常？', options: [['先交出一个可运行版本，再逐步优化', 'A'], ['先确定标准和结构，宁可晚一点开始', 'F']] },
  { question: '共同任务里，你更舒适的工作方式是？', options: [['频繁对齐、一起想办法，把球传起来', 'C'], ['各自负责清晰模块，最后高质量合并', 'I']] },
  { question: '收到朋友临时邀约时，你更常？', options: [['先判断自己状态和兴趣，再决定是否加入', 'I'], ['看谁也想去，拉个小队一起出发', 'C']] },
  { question: '你更希望伙伴如何支持你？', options: [['随时交流、互相提醒，不让人掉线', 'C'], ['尊重节奏和空间，需要时再深聊', 'I']] },
  { question: '一段关系刚熟起来时，你更喜欢？', options: [['固定一点见面节奏，慢慢建立可靠感', 'N'], ['保留新鲜场景，每次见面都有点不同', 'P']] },
  { question: '做长期计划时，你最在意？', options: [['是否仍有探索空间，随时可以调方向', 'P'], ['能否稳定地坚持，不被生活轻易打断', 'N']] },
  { question: '一个熟悉活动和一个新活动撞期，你更容易选？', options: [['熟悉的那个，关系和体验会更可控', 'N'], ['新的那个，未知也许会带来惊喜', 'P']] },
  { question: '讨论分歧时，你通常更偏向？', options: [['先独立想清观点，再选择合适时机表达', 'R'], ['主动把不同人拉回同一张桌子上', 'E']] },
  { question: '准备一次合作前，你更愿意先？', options: [['写清目标、分工和时间线', 'S'], ['约个短聊，把可能性打开', 'X']] },
  { question: '当你犹豫要不要报名活动时，最有效的推动是？', options: [['先弄清价值和成本，决定后更安心', 'F'], ['先报再说，给自己一个开始的理由', 'A']] },
  { question: '你更容易对哪种搭子产生信任？', options: [['能独立负责、说到做到的人', 'I'], ['愿意一起商量、及时回应的人', 'C']] },
  { question: '理想的校园生活更接近？', options: [['不断尝试新场景，保留意外的入口', 'P'], ['有几件稳定会发生的小事和熟人', 'N']] },
]

const cbtiArchetypes = [
  ['ES-ACN', '连接策展人', ['关系编排', '稳定组织', '照顾节奏']], ['ES-FCN', '温柔领航员', ['倾听清晰', '可靠陪伴', '慢热发光']], ['EX-ACP', '人群点火器', ['敢先开口', '现场能量', '新局发起']], ['EX-AIP', '灵感夜班车', ['跨界好奇', '快速试验', '自由协作']], ['RX-FIN', '静水深流者', ['独立思考', '稳态投入', '深度连接']], ['RX-AIP', '探索侦察兵', ['发现新路', '轻装行动', '一人也行']], ['RS-FCN', '可靠策划组长', ['结构清晰', '长期主义', '落地负责']], ['RS-FIN', '安静专业户', ['专注打磨', '边界清楚', '质量优先']], ['ES-AIN', '行动搭桥者', ['高效连接', '执行落地', '稳定响应']], ['RX-FCP', '新鲜感翻译官', ['敏感观察', '创意转译', '轻盈共创']],
] as const

const tarotDeck: TarotCard[] = [
  { title: '星星米饭牌', art: 'rice', line: '一碗热饭会把零散的心意聚拢，适合从一顿饭开始新的连接。', tone: 'lemon' },
  { title: '太阳牌', art: 'gate', line: '校门口的徽章亮起来了：今天适合大胆出现，让人先看见你。', tone: 'coral' },
  { title: '月亮牌', art: 'moon', line: '深夜窗边的月亮提醒你：慢一点说，真话会自己发光。', tone: 'mint' },
  { title: '空位牌', art: 'library', line: '有人刚好坐在你的日常旁边，安静的并肩也能成为默契。', tone: 'mint' },
  { title: '共伞牌', art: 'umbrella', line: '天气会替嘴硬的人制造借口，带伞的人也带着新的可能。', tone: 'coral' },
  { title: '夜风牌', art: 'track', line: '说好走一圈，最后走了很久；别急着给关系命名。', tone: 'mint' },
  { title: '泡面牌', art: 'noodles', line: '临时组队的热气还在，先把一个小点子做出来。', tone: 'lemon' },
]

const mockFriends: Record<string, CampusProfile> = {
  'DADA-LX21': { nickname: '林知夏', school: '同济大学', college: '设计创意学院', major: '工业设计', grade: '大三', interests: 'AI、交互设计、作品集、逛展', sbtiCode: 'ES-BETA', roleName: '灵感夜班车', tags: ['灵感捕手', '跨界搭子', '逛展雷达'], dadaId: 'DADA-LX21' },
  'DADA-MG88': { nickname: '马更', school: '复旦大学', college: '新闻学院', major: '新闻学', grade: '大二', interests: '跑步、播客、校园活动', sbtiCode: 'SP-BETA', roleName: '人群点火器', tags: ['活动发动机', '听故事的人', '临场不怯'], dadaId: 'DADA-MG88' },
}

const campusOptions = ['上海交通大学', '复旦大学', '同济大学', '华东师范大学']

function loadProfile(): CampusProfile | null {
  localStorage.removeItem(STORAGE_KEY)
  return null
}

function saveProfile(_profile: CampusProfile) {
  // Beta intentionally keeps profile data only in memory for the current visit.
}

function makeDadaId() {
  return `DADA-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function hasProfileCard(profile: CampusProfile | null) {
  return Boolean(profile?.nickname && profile.school && profile.college && profile.major && profile.grade && profile.interests && profile.dadaId)
}

function hasCbti(profile: CampusProfile | null) {
  return Boolean(profile?.sbtiCode)
}

const cbtiReportHeadings = ['【校园节奏】', '【你的优势】', '【压力提示】', '【本周试试】']

function isStructuredCbtiReport(report: unknown): report is string {
  return typeof report === 'string'
    && report.length >= 220
    && report.length <= 310
    && cbtiReportHeadings.every((heading) => report.includes(heading))
}

function makePersona(selected: CbtiAxis[]): Pick<CampusProfile, 'sbtiCode' | 'roleName' | 'tags' | 'personaReport'> {
  const score = selected.reduce<Record<CbtiAxis, number>>((result, key) => ({ ...result, [key]: result[key] + 1 }), { E: 0, R: 0, X: 0, S: 0, A: 0, F: 0, C: 0, I: 0, N: 0, P: 0 })
  const code = `${score.E >= score.R ? 'E' : 'R'}${score.X >= score.S ? 'X' : 'S'}-${score.A >= score.F ? 'A' : 'F'}${score.C >= score.I ? 'C' : 'I'}${score.N >= score.P ? 'N' : 'P'}`
  const nearest = cbtiArchetypes.map(([typeCode, roleName, tags]) => ({ typeCode, roleName, tags, distance: [...code].reduce((total, letter, index) => total + (letter === typeCode[index] ? 0 : 1), 0) })).sort((a, b) => a.distance - b.distance)[0]
  return {
    sbtiCode: code,
    roleName: nearest.roleName,
    tags: [...nearest.tags],
    personaReport: `【校园节奏】作为「${nearest.roleName}」，你通常会先感受当下的人与机会，再决定怎样投入；熟悉的校园场景和清晰的共同目标，会让你更容易进入稳定又舒服的节奏。\n` +
      `【你的优势】你的${nearest.tags[0]}和${nearest.tags[1]}会帮助你捕捉同频的人，也能把模糊的兴趣转成一次具体邀约或合作；别人常能从你的反应里感到被接住。\n` +
      `【压力提示】当信息太多、关系期待不清或时间被打乱时，你可能会在热情和犹豫之间来回切换，或暂时把想法留在心里；这更像是调节节奏，不代表能力不足。\n` +
      `【本周试试】选一件想推进的小事，约一位让你感到轻松的同学，用二十分钟说清目标、可投入时间和下一步；结束时只确定一个可完成的小动作，再决定是否继续。`,
  }
}

function pickCards(): DrawnTarotCard[] {
  const shuffled = [...tarotDeck].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 3).map((card) => ({ ...card, reversed: Math.random() < .5 }))
}

function draftProfileFromChat(text: string, current: CampusProfile | null): CampusProfile | null {
  const school = campusOptions.find((item) => text.includes(item)) ?? current?.school ?? ''
  const grade = text.match(/大[一二三四]|研[一二三]|新生/)?.[0] ?? current?.grade ?? ''
  const major = text.match(/(?:学|读|是)([^，。,；;]{2,10})(?:专业|系)/)?.[1] ?? current?.major ?? ''
  const nickname = text.match(/(?:我叫|我是)([^，。,；;]{2,8})/)?.[1]?.replace(/(大[一二三四]|研[一二三]).*/, '') ?? current?.nickname ?? ''
  const interests = /想|喜欢|最近|在做/.test(text) ? text : current?.interests ?? ''
  const draft: CampusProfile = { nickname, school, college: current?.college ?? '', major, grade, interests, dadaId: current?.dadaId ?? '', sbtiCode: current?.sbtiCode ?? '', roleName: current?.roleName ?? '', tags: current?.tags ?? [] }
  return Object.values(draft).some((value) => typeof value === 'string' && value) ? draft : null
}

function buildMatchSuggestion(profile: CampusProfile) {
  const topic = profile.interests.split(/[、，,]/).map((item) => item.trim()).find(Boolean) || '校园探索'
  const groupName = `${topic} 同频搭子群`
  const candidate: CampusProfile = { nickname: '林知夏', school: profile.school || '同济大学', college: '跨校协作计划', major: profile.major || '交互设计', grade: profile.grade || '大三', interests: `也在关注${topic}，想找轻松、能一起行动的搭子`, sbtiCode: 'ES-BETA', roleName: '灵感接力员', tags: ['同频方向', '愿意破冰', '一起行动'], dadaId: 'DADA-LX21' }
  return { groupId: `group:${groupName}`, groupName, candidate, messages: [{ id: crypto.randomUUID(), kind: 'text' as const, sender: 'dada' as const, text: `欢迎来到「${groupName}」。哒哒已同步了你的方向：${profile.interests || topic}。先用一句话说说你最想一起做的那件事吧。` }, { id: crypto.randomUUID(), kind: 'text' as const, sender: 'dada' as const, text: '破冰提示：本周你愿意拿出多少时间，一起把什么小目标启动？' }] }
}

function nextBetaProfileCards(profile: CampusProfile): BetaMessage[] {
  return [
    { id: crypto.randomUUID(), kind: 'profile-card', profile },
    { id: crypto.randomUUID(), kind: 'text', sender: 'dada', text: `校园名片收好啦，${profile.nickname}。接下来做 6 道校园 CBTI 小题，我会据此理解你的社交节奏。` },
    { id: crypto.randomUUID(), kind: 'feature', feature: 'cbti' },
  ]
}

function nextBetaToolCards(profile: CampusProfile): BetaMessage[] {
  return [
    { id: crypto.randomUUID(), kind: 'text', sender: 'dada', text: `你的校园 CBTI「${profile.roleName}」已生成。现在可以直接找搭子、测朋友契合度；想轻松一点也可以抽搭罗牌。` },
    { id: crypto.randomUUID(), kind: 'feature', feature: 'tarot' },
    { id: crypto.randomUUID(), kind: 'feature', feature: 'compatibility' },
    { id: crypto.randomUUID(), kind: 'feature', feature: 'match' },
  ]
}

function FeatureCard({ feature, profile, onOpen }: { feature: Feature; profile: CampusProfile | null; onOpen: (feature: Feature) => void }) {
  const copy = featureCopy[feature]
  const profileReady = hasProfileCard(profile)
  const matchReady = profileReady && hasCbti(profile)
  const locked = (feature === 'cbti' && !profileReady) || (feature === 'compatibility' && !matchReady) || (feature === 'match' && !matchReady)
  const disabled = feature === 'answer-book' || locked
  return (
    <article className={`beta-feature-card ${disabled ? 'is-soon' : ''}`}>
      <span className="beta-feature-icon">{copy.icon}</span>
      <div>
        <strong>{copy.title}</strong>
        <p>{locked ? (feature === 'match' || feature === 'compatibility') ? (profileReady ? '完成 CBTI 后解锁' : '完成搭搭卡和 CBTI 后解锁') : '完成搭搭卡后解锁' : copy.subtitle}</p>
        <button type="button" disabled={disabled} onClick={() => onOpen(feature)}>{copy.button}</button>
      </div>
    </article>
  )
}

function CampusProfileCard({ profile }: { profile: CampusProfile }) {
  const identity = [profile.school, profile.college, profile.grade, profile.major].filter(Boolean).join(' · ')
  return <article className="beta-campus-profile-card"><div className="beta-profile-card-top"><span className="beta-profile-mascot" aria-hidden="true"><i className="beta-profile-cap">⌂</i><i className="beta-profile-face">•ᴗ•</i><i className="beta-profile-body">✦</i></span><div><small>{profile.dadaId}</small><h3>{profile.nickname || '校园同学'}</h3><p>{identity || '校园坐标待补充'}</p></div></div><p className="beta-profile-card-focus">{profile.interests || '正在探索校园生活的更多可能'}</p>{hasCbti(profile) && <div className="beta-profile-card-sbti"><strong>{profile.sbtiCode}</strong><span>{profile.roleName}</span></div>}</article>
}

function ConversationRow({ item, active, onSelect }: { item: BetaConversation; active: boolean; onSelect: (id: string) => void }) {
  return <button className={`beta-conversation ${active ? 'active' : ''}`} type="button" onClick={() => onSelect(item.id)}>{item.kind === 'dada' ? <img className="beta-list-avatar beta-dada-avatar" alt="哒哒大王头像" src={DADA_AVATAR} /> : <span className="beta-list-avatar is-group">{item.badge}</span>}<span className="beta-conversation-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span>{item.isNew && <em>NEW</em>}</button>
}

function MiniProgramIcon({ name }: { name: 'card' | 'cbti' | 'tarot' | 'compatibility' | 'match' }) {
  const paths = {
    card: <><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="8" cy="10" r="2" /><path d="M12 10h5M12 14h5M6 16h4" /></>,
    cbti: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" /><path d="M12 4v3M20 12h-3M12 20v-3M4 12h3" /></>,
    tarot: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="m12 7 .9 2.1L15 10l-2.1.9L12 13l-.9-2.1L9 10l2.1-.9L12 7ZM8.5 16.5h7" /></>,
    compatibility: <><circle cx="8.5" cy="12" r="4.5" /><circle cx="15.5" cy="12" r="4.5" /><path d="M10 12h4" /></>,
    match: <><circle cx="9" cy="8" r="3" /><circle cx="16.5" cy="9.5" r="2.5" /><path d="M3.5 19c.7-3 2.7-4.5 5.5-4.5s4.8 1.5 5.5 4.5M14 18.5c.5-1.8 1.8-2.8 3.8-2.8 1.3 0 2.3.4 3.1 1.3" /></>,
  }
  return <svg className="mini-program-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>
}

export function BetaApp() {
  const [conversations, setConversations] = useState<BetaConversation[]>([{ id: 'dada-main', title: 'AAA 哒哒大王 👑', subtitle: 'Beta · 校园全能好朋友', kind: 'dada', badge: '搭' }])
  const [activeConversationId, setActiveConversationId] = useState('dada-main')
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, BetaMessage[]>>({ 'dada-main': initialMessages })
    const [draft, setDraft] = useState<string>('')
  const [panel, setPanel] = useState<Panel>(null)
  const [profile, setProfile] = useState<CampusProfile | null>(loadProfile)
  const [aiKey, setAiKey] = useState<string | null>(null)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [isUnlocking, setIsUnlocking] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)

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

  const activeConversation = conversations.find((item) => item.id === activeConversationId) ?? conversations[0]
  const messages = messagesByConversation[activeConversationId] ?? []
  const isGroupConversation = activeConversation.kind === 'group'
  const appendToConversation = (conversationId: string, message: BetaMessage) => setMessagesByConversation((current) => ({ ...current, [conversationId]: [...(current[conversationId] ?? []), message] }))
  const appendToDada = (message: BetaMessage) => appendToConversation('dada-main', message)

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })
  }, [activeConversationId, messages.length, panel])

  const recommendGroup = () => {
    const suggestion = buildMatchSuggestion(profile ?? { nickname: '', school: '', college: '', major: '', grade: '', interests: '', dadaId: '', sbtiCode: '', roleName: '', tags: [] })
    setConversations((current) => current.some((item) => item.id === suggestion.groupId) ? current : [...current, { id: suggestion.groupId, title: suggestion.groupName, subtitle: `推荐 · ${profile?.interests || '校园同频'}`, kind: 'group', badge: '群', isNew: true }])
    setMessagesByConversation((current) => current[suggestion.groupId] ? current : { ...current, [suggestion.groupId]: suggestion.messages })
    appendToDada({ id: crypto.randomUUID(), kind: 'text', sender: 'dada', text: `我给你推了「${suggestion.groupName}」，已经出现在左侧聊天列表。另有一位可能同频的同学，先看看 Ta 的名片。` })
    appendToDada({ id: crypto.randomUUID(), kind: 'candidate-card', profile: suggestion.candidate })
  }

  const openFeature = (feature: Feature) => {
    if (feature === 'answer-book') return
    setPanel(feature)
  }

  const sendMessage = async () => {
    const text = draft.trim()
    if (!text) return
    appendToConversation(activeConversationId, { id: crypto.randomUUID(), kind: 'text', sender: 'user', text })
    setDraft('')
    if (/塔罗|搭罗|抽牌|crush|感情/.test(text)) { setPanel('tarot'); return }
    if (/CBTI|人格|测试/.test(text)) { setPanel('cbti'); return }
    if (/契合|朋友|合不合/.test(text)) { setPanel('compatibility'); return }
    if (/找搭子|组队|一起|找人|同学/.test(text)) { setPanel('match'); return }
    const profileDraft = draftProfileFromChat(text, profile)
    if (profileDraft) {
      setProfile(profileDraft)
      setPanel('profile-card')
      return
    }
    if (/名片|学校|学院|专业|年级/.test(text)) { setPanel('profile-card'); return }
      appendToConversation(activeConversationId, { id: crypto.randomUUID(), kind: 'text', sender: 'dada', text: '我可以从聊天里带你去填校园名片、做 CBTI、抽搭罗牌、测朋友契合度或找搭子。你现在最想做的是什么呢？' })
  }

  const saveProgress = (nextProfile: CampusProfile, reply: string) => {
    setProfile(nextProfile)
    saveProfile(nextProfile)
    setPanel(null)
    appendToDada({ id: crypto.randomUUID(), kind: 'text', sender: 'dada', text: reply })
  }

  const onCbtiReady = (persona: Pick<CampusProfile, 'sbtiCode' | 'roleName' | 'tags'>) => {
    const nextProfile: CampusProfile = { nickname: profile?.nickname ?? '', school: profile?.school ?? '', college: profile?.college ?? '', major: profile?.major ?? '', grade: profile?.grade ?? '', interests: profile?.interests ?? '', dadaId: profile?.dadaId ?? '', ...persona }
    saveProgress(nextProfile, hasProfileCard(nextProfile)
      ? `校园 CBTI「${nextProfile.roleName}」已更新。`
      : `校园 CBTI「${nextProfile.roleName}」已生成。下一步请打开「我的校园名片」补全校园坐标。`)
    if (hasProfileCard(nextProfile)) nextBetaToolCards(nextProfile).forEach(appendToDada)
  }

  const onProfileReady = (details: Pick<CampusProfile, 'nickname' | 'school' | 'college' | 'major' | 'grade' | 'interests'>) => {
    const nextProfile: CampusProfile = { ...details, dadaId: profile?.dadaId || makeDadaId(), sbtiCode: profile?.sbtiCode ?? '', roleName: profile?.roleName ?? '', tags: profile?.tags ?? [] }
    saveProgress(nextProfile, `你的校园名片已生成，DADA-ID 是 ${nextProfile.dadaId}。`)
    if (hasCbti(nextProfile)) nextBetaToolCards(nextProfile).forEach(appendToDada)
    else nextBetaProfileCards(nextProfile).forEach(appendToDada)
  }

  return (
    <main className="beta-shell">
      <aside className="beta-conversation-list" aria-label="聊天列表">
        <div className="beta-list-heading"><span className="beta-list-brand">搭</span><div><strong>DadaPal Beta</strong><small>校园全能好朋友</small></div></div>
        <p className="beta-list-section">聊天</p>
        {conversations.filter((item) => item.kind === 'dada').map((item) => <ConversationRow key={item.id} item={item} active={item.id === activeConversationId} onSelect={setActiveConversationId} />)}
        {conversations.some((item) => item.kind === 'group') && <><p className="beta-list-section">找搭子推荐群</p>{conversations.filter((item) => item.kind === 'group').map((item) => <ConversationRow key={item.id} item={item} active={item.id === activeConversationId} onSelect={setActiveConversationId} />)}</>}
      </aside>
      <section className="beta-phone" aria-label="DadaPal Beta 聊天">
        <div className="beta-statusbar" aria-hidden="true">
          <span>9:41</span>
          <span className="beta-status-icons">▮▮▮ 5G ▰</span>
        </div>
        <header className="beta-header"><div className="beta-header-title">{isGroupConversation ? <span className="beta-avatar">{activeConversation.badge}</span> : <img className="beta-avatar beta-dada-avatar" alt="哒哒大王头像" src={DADA_AVATAR} />}<div><strong>{activeConversation.title}</strong><small>{activeConversation.subtitle}</small></div></div>{!isGroupConversation && <span className="beta-live">测试中</span>}</header>
        <div className="beta-feed" ref={feedRef}>
          <p className="beta-time">DadaPal Beta 内测</p>
          {messages.map((message) => message.kind === 'text' ? (
            <div className={`beta-message ${message.sender}`} key={message.id}>
              {message.sender === 'dada' && (isGroupConversation ? <span className="beta-avatar">{activeConversation.badge}</span> : <img className="beta-avatar beta-dada-avatar" alt="哒哒大王头像" src={DADA_AVATAR} />)}
              <p>{message.text}</p>
            </div>
          ) : message.kind === 'feature' ? <div className="beta-card-row" key={message.id}><img className="beta-avatar beta-dada-avatar" alt="哒哒大王头像" src={DADA_AVATAR} /><FeatureCard feature={message.feature} profile={profile} onOpen={openFeature} /></div> : message.kind === 'profile-card' || message.kind === 'candidate-card' ? <div className="beta-card-row" key={message.id}><img className="beta-avatar beta-dada-avatar" alt="哒哒大王头像" src={DADA_AVATAR} /><CampusProfileCard profile={message.profile} /></div> : <div className="beta-card-row" key={message.id}><img className="beta-avatar beta-dada-avatar" alt="哒哒大王头像" src={DADA_AVATAR} /><TarotChatCard cards={message.cards} interpretation={message.interpretation} /></div>)}
        </div>
        <form className="beta-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}><input value={draft} disabled={isGroupConversation} onChange={(event) => setDraft(event.target.value)} placeholder={isGroupConversation ? '推荐群暂不支持发言' : '可以直接说想做什么，或聊聊你的校园生活…'} /><button type="submit" disabled={isGroupConversation}>发送</button></form>
        <div className="beta-home-indicator" aria-hidden="true" />
      </section>

      {panel === 'profile-card' && <ProfileCardPanel profile={profile} onClose={() => setPanel(null)} onNavigate={setPanel} onComplete={onProfileReady} />}
      {panel === 'cbti' && <CbtiPanel apiKey={aiKey} existingProfile={profile} onClose={() => setPanel(null)} onNavigate={setPanel} onComplete={onCbtiReady} />}
      {panel === 'tarot' && <TarotPanel apiKey={aiKey} profile={profile} onClose={() => setPanel(null)} onNavigate={setPanel} onComplete={(cards, interpretation) => { appendToDada({ id: crypto.randomUUID(), kind: 'tarot-reading', cards, interpretation }); setPanel(null) }} />}
      {panel === 'compatibility' && <CompatibilityPanel apiKey={aiKey} profile={profile} onClose={() => setPanel(null)} onOpenFeature={setPanel} />}
      {panel === 'match' && <MatchPanel apiKey={aiKey} profile={profile} onClose={() => setPanel(null)} onOpenFeature={setPanel} onRecommendGroup={recommendGroup} />}
      {!aiKey && <div className="ai-unlock-overlay" role="dialog" aria-modal="true" aria-label="解锁 AI 功能"><section className="ai-unlock-card"><span className="ai-unlock-mark">搭</span><h1>解锁哒哒 AI</h1><p>输入访问密码后，可使用实时搭罗解读与找搭子引导。密钥只保留在本次页面内存中。</p><form onSubmit={(event) => { event.preventDefault(); void unlockAi() }}><input type="password" autoFocus value={unlockPassword} onChange={(event) => setUnlockPassword(event.target.value)} placeholder="访问密码" /><button type="submit" disabled={isUnlocking}>{isUnlocking ? '正在解锁…' : '解锁并开始'}</button></form>{unlockError && <small>{unlockError}</small>}</section></div>}
    </main>
  )
}

function Modal({ title, subtitle, children, profile, onClose, onNavigate }: { title: string; subtitle: string; children: React.ReactNode; profile: CampusProfile | null; onClose: () => void; onNavigate: (feature: Panel) => void }) {
  const activeTab = title === '我的搭搭卡' ? 'card' : title === '校园 CBTI' ? 'cbti' : title === '搭罗牌' ? 'tarot' : title === '好友契合度' ? 'friend' : title === '找个搭子' ? 'match' : ''
  const locked = !hasProfileCard(profile)
  const matchLocked = locked || !hasCbti(profile)
  return <div className="beta-overlay" role="dialog" aria-modal="true" aria-label={title}><section className="beta-modal"><div className="mini-program-nav"><div className="mini-program-capsule" aria-label="小程序系统菜单"><button className="mini-program-more" type="button" aria-label="更多操作"><i /><i /><i /></button><span aria-hidden="true" /><button className="mini-program-close" type="button" onClick={onClose} aria-label="关闭并返回微信"><i /></button></div></div><header><div className="mini-program-heading"><span className="mini-program-mark">搭</span><div><h1>{title}</h1><p>{subtitle}</p></div></div></header><div className="mini-program-content">{children}</div><nav className="mini-program-tabs" aria-label="小程序功能"><button className={activeTab === 'card' ? 'active' : ''} type="button" onClick={() => onNavigate('profile-card')}><MiniProgramIcon name="card" />搭搭卡</button><button className={`${activeTab === 'cbti' ? 'active' : ''} ${locked ? 'locked' : ''}`} type="button" disabled={locked} onClick={() => onNavigate('cbti')}><MiniProgramIcon name="cbti" />CBTI</button><button className={activeTab === 'tarot' ? 'active' : ''} type="button" onClick={() => onNavigate('tarot')}><MiniProgramIcon name="tarot" />搭罗牌</button><button className={`${activeTab === 'friend' ? 'active' : ''} ${matchLocked ? 'locked' : ''}`} type="button" disabled={matchLocked} onClick={() => onNavigate('compatibility')}><MiniProgramIcon name="compatibility" />契合度</button><button className={`${activeTab === 'match' ? 'active' : ''} ${matchLocked ? 'locked' : ''}`} type="button" disabled={matchLocked} onClick={() => onNavigate('match')}><MiniProgramIcon name="match" />找搭子</button></nav></section></div>
}

function ProfileCardPanel({ profile, onClose, onNavigate, onComplete }: { profile: CampusProfile | null; onClose: () => void; onNavigate: (feature: Panel) => void; onComplete: (details: Pick<CampusProfile, 'nickname' | 'school' | 'college' | 'major' | 'grade' | 'interests'>) => void }) {
  const [form, setForm] = useState({ nickname: profile?.nickname ?? '', school: profile?.school ?? '', college: profile?.college ?? '', major: profile?.major ?? '', grade: profile?.grade ?? '', interests: profile?.interests ?? '' })
  const [schoolMenuOpen, setSchoolMenuOpen] = useState(false)
  const ready = Object.values(form).every((value) => value.trim())
  const selectSchool = (school: string) => {
    setForm({ ...form, school })
    setSchoolMenuOpen(false)
  }
  return <Modal title="我的搭搭卡" subtitle="填写你的校园坐标，生成 DADA-ID；这张名片是找搭子和好友契合度的基础。" profile={profile} onClose={onClose} onNavigate={onNavigate}>
    <section className="mini-card-page"><div className="mini-card-preview"><div className="mini-card-avatar" aria-hidden="true"><span className="mascot-cap">⌂</span><span className="mascot-face">•ᴗ•</span><span className="mascot-body">✦</span></div><div><small>{profile?.dadaId || 'DADA-ID 待生成'}</small><h2>{form.nickname || '你的名字'}</h2><p>{[form.school, form.college, form.grade, form.major].filter(Boolean).join(' · ') || '填写你的校园坐标'}</p><p>{form.interests || '添加最近在做的事或兴趣'}</p></div></div><div className="beta-form-grid"><label>昵称<input value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} placeholder="例如：小周" /></label><div className="beta-wide-label">学校<div className="school-dropdown"><button type="button" className="school-dropdown-trigger" aria-expanded={schoolMenuOpen} onClick={() => setSchoolMenuOpen(!schoolMenuOpen)}>{form.school || '请选择学校'}<span aria-hidden="true">⌄</span></button>{schoolMenuOpen && <div className="school-dropdown-menu">{campusOptions.map((school) => <button key={school} type="button" className={form.school === school ? 'selected' : ''} onClick={() => selectSchool(school)}>{school}</button>)}</div>}</div></div><label>学院<input value={form.college} onChange={(event) => setForm({ ...form, college: event.target.value })} placeholder="例如：设计创意学院" /></label><label>专业<input value={form.major} onChange={(event) => setForm({ ...form, major: event.target.value })} placeholder="例如：计算机" /></label><label>年级<input value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })} placeholder="例如：大三" /></label></div><label className="beta-wide-label">最近喜欢 / 正在做什么<input value={form.interests} onChange={(event) => setForm({ ...form, interests: event.target.value })} placeholder="例如：网球、AI 项目、逛展" /></label><button className="beta-primary" type="button" disabled={!ready} onClick={() => onComplete(form)}>生成我的校园名片</button></section>
  </Modal>
}

function CbtiResultCard({ persona, isAnalyzing }: { persona: Pick<CampusProfile, 'sbtiCode' | 'roleName' | 'tags' | 'personaReport'>; isAnalyzing: boolean }) {
  return <div className="beta-persona-preview cbti-persona-card"><div className="cbti-persona-character" aria-hidden="true"><i className="cbti-persona-soft-face">•ᴗ•</i><i className="cbti-persona-soft-note">✦</i><b>⌁</b></div><div><span>{persona.sbtiCode}</span><h2>{persona.roleName}</h2><p>{persona.tags.join(' · ')}</p></div><div className="cbti-report"><strong>你的报告</strong>{isAnalyzing ? <p>哒哒正在结合你的 20 个选择，整理一份完整报告…</p> : <p>{persona.personaReport}</p>}</div></div>
}

function CbtiPanel({ apiKey, existingProfile, onClose, onNavigate, onComplete }: { apiKey: string | null; existingProfile: CampusProfile | null; onClose: () => void; onNavigate: (feature: Panel) => void; onComplete: (persona: Pick<CampusProfile, 'sbtiCode' | 'roleName' | 'tags' | 'personaReport'>) => void }) {
  const [step, setStep] = useState(hasCbti(existingProfile) ? questions.length : 0)
  const [answers, setAnswers] = useState<CbtiAxis[]>([])
  const [result, setResult] = useState<Pick<CampusProfile, 'sbtiCode' | 'roleName' | 'tags' | 'personaReport'> | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const completed = step >= questions.length
  const question = questions[Math.min(step, questions.length - 1)]
  const persona = useMemo(() => makePersona(answers), [answers])

  const choose = (value: CbtiAxis) => {
    setAnswers((current) => [...current, value])
    setStep((current) => current + 1)
  }

  useEffect(() => {
    if (!completed || result || answers.length !== questions.length) return
    const baseline = makePersona(answers)
    if (!apiKey) {
      setResult(baseline)
      return
    }
    let cancelled = false
    setIsAnalyzing(true)
    const answerSummary = answers.map((answer, index) => `${index + 1}:${answer}`).join(' ')
    askOpenRouter<Pick<CampusProfile, 'sbtiCode' | 'roleName' | 'tags' | 'personaReport'>>(apiKey, `你是审慎的校园行为画像助手。CBTI 是校园情境下的行为偏好原型，不是临床心理测量或人格诊断；请根据20道强制二选一的选择，在十个候选类型中选一个最贴近的类型。不要过度推断，不要医学化。

严格输出 JSON，字段仅为 sbtiCode、roleName、tags、personaReport。tags 必须是恰好3个简短中文标签。personaReport 必须为220-280个中文字符，且严格按下面四段的顺序输出；每段之间必须有一个换行符，不得使用 Markdown、不得增加标题或结语：
【校园节奏】用50-65字描述在社交、探索与行动中的典型节奏，避免绝对化。
【你的优势】用50-65字说明两个可观察到的校园协作或连接优势。
【压力提示】用50-65字说明在信息过载、关系或任务压力下可能出现的倾向，并保持非诊断性。
【本周试试】用50-65字给出一个低门槛、可在本周执行的具体行动，写清第一步和完成标准。

候选类型：${cbtiArchetypes.map(([code, name]) => `${code} ${name}`).join('；')}。算法基线：${baseline.sbtiCode} ${baseline.roleName}；答案：${answerSummary}`, 550).then((value) => {
      if (!cancelled && cbtiArchetypes.some(([code, name]) => code === value.sbtiCode && name === value.roleName) && Array.isArray(value.tags) && isStructuredCbtiReport(value.personaReport)) setResult({ ...value, tags: value.tags.slice(0, 3) })
    }).catch(() => undefined).finally(() => {
      if (!cancelled) {
        setResult((current) => current ?? baseline)
        setIsAnalyzing(false)
      }
    })
    return () => { cancelled = true }
  }, [answers, apiKey, completed, result])

  return <Modal title="校园 CBTI" subtitle="Campus Based Type Indicator：一张更好认识你的校园社交人格卡。" profile={existingProfile} onClose={onClose} onNavigate={onNavigate}>
    {!completed ? <section className="cbti-quiz"><div className="cbti-hero"><span>CBTI · 校园行为画像</span><h2>20 个校园情境</h2><p>每题选择当下更接近你的一个反应。没有好坏答案；它描述的是偏好，不是给人定型。</p><div className="cbti-mascot" aria-hidden="true">•ᴗ•</div></div><div className="sbti-question"><div className="beta-progress"><span style={{ width: `${(step / questions.length) * 100}%` }} /></div><small>{step + 1} / {questions.length} · 二选一</small><h2>{question.question}</h2><div className="sbti-options">{question.options.map(([label, value]) => <button key={value} type="button" onClick={() => choose(value)}>{label}</button>)}</div></div></section> : <section className="sbti-profile"><CbtiResultCard persona={result ?? persona} isAnalyzing={isAnalyzing} /><p className="beta-form-note">这是校园情境下的行为偏好参考，不是心理诊断；可用于好友契合度与找搭子。</p><div className="cbti-actions"><button className="beta-secondary" type="button" onClick={() => { setAnswers([]); setStep(0); setResult(null) }}>我要重做 CBTI</button><button className="beta-primary" type="button" disabled={!result || isAnalyzing} onClick={() => onComplete(result ?? persona)}>保存校园 CBTI</button></div></section>}
  </Modal>
}

function TarotPanel({ apiKey, profile, onClose, onNavigate, onComplete }: { apiKey: string | null; profile: CampusProfile | null; onClose: () => void; onNavigate: (feature: Panel) => void; onComplete: (cards: DrawnTarotCard[], interpretation: string) => void }) {
  const [question, setQuestion] = useState('大学的第一个 crush 会在哪里出现？')
  const [cards, setCards] = useState<DrawnTarotCard[] | null>(null)
  const [phase, setPhase] = useState<'idle' | 'dealing' | 'revealed'>('idle')
  const [analysis, setAnalysis] = useState<TarotAnalysis | null>(null)
  const [isInterpreting, setIsInterpreting] = useState(false)
  const fallbackAnalysis = useMemo<TarotAnalysis | null>(() => cards ? { surface: `**牌面元素**：${cards.map((card) => `${card.title} ${card.reversed ? '逆位' : '正位'}`).join('、')}。这组校园日常意象提醒你先看见正在发生的细小互动。`, depth: `**深层关系**：${profile?.roleName ?? '此刻的你'}不需要急着为答案命名，把好奇变成一次自然靠近就已经足够。`, structure: '**组合结构**：第一张铺开当下氛围，第二张提示触发方式，第三张把故事落到一个真实可行动的校园场景。', guidance: '**指引**：接下来一周，尝试一次低压力邀请；先回应当下，再观察对方是否也愿意继续这段对话。' } : null, [cards, profile?.roleName])
  useEffect(() => {
    if (phase !== 'dealing') return
    const timer = window.setTimeout(() => setPhase('revealed'), 900)
    return () => window.clearTimeout(timer)
  }, [phase])
  useEffect(() => {
    if (phase !== 'revealed' || !cards) return
    let cancelled = false
    setIsInterpreting(true)
    setAnalysis(null)
    if (!apiKey) return
    const cardDetails = cards.map((card) => `${card.title}（${card.reversed ? '逆位' : '正位'}）：${card.line}`).join('；')
    askOpenRouter<TarotAnalysis>(apiKey, `你是一位专业、温柔但不作确定预言的校园塔罗解读师。根据问题和三张牌，输出严格 JSON，只有 surface、depth、structure、guidance 四个中文字符串字段。四段总计不少于850个中文字符，每段180-260字；每段使用1-2处 **关键词**。第一段逐张解释牌面，第二段联系提问做深层分析，第三段解释三张牌的结构关系，第四段给出具体低风险行动指引。避免医疗、财务与绝对化结论。\n问题：${question}\n牌：${cardDetails}`, 1400).then((result) => {
      if (!cancelled) setAnalysis(result)
    }).catch(() => {
      if (!cancelled) setAnalysis(fallbackAnalysis)
    }).finally(() => {
      if (!cancelled) setIsInterpreting(false)
    })
    return () => { cancelled = true }
  }, [apiKey, cards, fallbackAnalysis, phase, question])
  const draw = () => {
    if (phase === 'dealing') return
    setCards(pickCards())
    setAnalysis(null)
    setPhase('dealing')
  }
  return <Modal title="搭罗牌" subtitle="问一个校园生活的问题，抽三张轻松一点的搭罗牌。" profile={profile} onClose={onClose} onNavigate={onNavigate}>
    <section className="tarot-panel"><section className="tarot-space"><div className="tarot-question-guide"><div className="tarot-guide-mascot" aria-hidden="true"><i /><em /><b>•ᴗ•</b><span>✦</span></div><p><strong>小搭罗</strong>已就位：宇宙不保证回答，但会认真偷看你的校园小心事。</p></div><label className="tarot-question-input">我想问<input value={question} onChange={(event) => setQuestion(event.target.value)} /></label><div className="tarot-deck-zone"><button type="button" className={`tarot-deck ${phase !== 'idle' ? 'is-drawing' : ''}`} onClick={draw} aria-label="抽取三张搭罗牌"><i /><i /><i /><b>✦</b></button><button type="button" className="tarot-draw-bubble" onClick={draw}>抽</button></div>{cards && <div className={`tarot-spread ${phase}`}><div className="tarot-card-slot"><TarotCardFace card={cards[0]} /></div><div className="tarot-card-slot"><TarotCardFace card={cards[1]} /></div><div className="tarot-card-slot"><TarotCardFace card={cards[2]} /></div></div>}</section>{phase === 'revealed' && cards && <article className="tarot-reading"><strong>{question || '你的校园问题'}</strong>{isInterpreting ? <p className="tarot-loading">小搭罗正在认真读牌，请给它一点点魔法时间…</p> : <TarotAnalysisView analysis={analysis ?? fallbackAnalysis as TarotAnalysis} />}<button type="button" disabled={isInterpreting} onClick={() => onComplete(cards, Object.values(analysis ?? fallbackAnalysis as TarotAnalysis).join('\n\n'))}>把这组搭罗牌发给我</button></article>}</section>
  </Modal>
}

function TarotAnalysisView({ analysis }: { analysis: TarotAnalysis }) {
  return <div className="tarot-analysis">{[['牌面', analysis.surface], ['关联', analysis.depth], ['结构', analysis.structure], ['指引', analysis.guidance]].map(([label, text]) => <p key={label}><small>{label}</small><RichTarotText text={text} /></p>)}</div>
}

function RichTarotText({ text }: { text: string }) {
  return <>{text.split(/(\*\*.*?\*\*)/g).map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part)}</>
}

function TarotCardFace({ card }: { card: DrawnTarotCard }) {
  return <article className={`tarot-card ${card.tone}`}><h3>{card.title}</h3><div className={`tarot-illustration ${card.art}`} aria-label={card.title}><i /><i /><i /><b /></div></article>
}

function TarotChatCard({ cards, interpretation }: { cards: DrawnTarotCard[]; interpretation: string }) {
  return <article className="beta-tarot-chat-card"><strong>你的三张搭罗牌</strong><div>{cards.map((card, index) => <TarotCardFace key={`${card.title}-${index}`} card={card} />)}</div><p>{interpretation}</p></article>
}

function MatchPanel({ apiKey, profile, onClose, onOpenFeature, onRecommendGroup }: { apiKey: string | null; profile: CampusProfile | null; onClose: () => void; onOpenFeature: (feature: Panel) => void; onRecommendGroup: () => void }) {
  const [messages, setMessages] = useState<{ sender: Sender; text: string }[]>([{ sender: 'dada', text: '嗨，我是哒哒大王。说说你现在在做什么，以及想找怎样的搭子？比如「周六想练网球，想找一个愿意一起从零开始的人」。' }])
  const [draft, setDraft] = useState('')
  const [quickReplies, setQuickReplies] = useState<string[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [canRecommendGroup, setCanRecommendGroup] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [isThinking, messages.length, quickReplies.length])

  const send = async (quickReply?: string) => {
    if (isThinking) return
    const text = (quickReply ?? draft).trim()
    if (!text) return
    setMessages((current) => [...current, { sender: 'user', text }])
    setDraft('')
    setQuickReplies([])
    setCanRecommendGroup(false)
    setIsThinking(true)
    try {
      if (!apiKey) throw new Error('AI is locked')
      const history = [...messages, { sender: 'user' as Sender, text }].slice(-8).map((message) => `${message.sender === 'dada' ? '哒哒' : '用户'}：${message.text}`).join('\n')
      const reply = await askOpenRouter<{ reply: string; quickReplies: string[]; readyToRecommend?: boolean }>(apiKey, `你是 AAA 哒哒大王，一个微信语气、温柔且主动的校园找搭子助手。根据聊天记录帮用户把活动、时间、地点、想遇见的人说清楚。先接住已知信息，再自然追问至多一个最有助匹配的缺失细节；信息足够时总结筛选条件并说明会据此匹配。不要编造真实同学或保证匹配成功。严格输出 JSON：reply（20-80字中文），quickReplies（0-3个短中文回复），readyToRecommend（布尔值；活动和对象偏好已清楚时为 true）。\n用户档案：${profile ? `${profile.school} ${profile.college} ${profile.grade} ${profile.major}；兴趣：${profile.interests}；CBTI：${profile.roleName}` : '未填写'}\n聊天记录：\n${history}`, 350)
      setMessages((current) => [...current, { sender: 'dada', text: reply.reply }])
      setQuickReplies(Array.isArray(reply.quickReplies) ? reply.quickReplies.slice(0, 3) : [])
      setCanRecommendGroup(reply.readyToRecommend === true)
    } catch {
      setMessages((current) => [...current, { sender: 'dada', text: '我这边刚刚没连上匹配助手。你可以再发一次，我会继续记住你刚才说的方向。' }])
    } finally {
      setIsThinking(false)
    }
  }
  if (!hasProfileCard(profile) || !hasCbti(profile)) return <Modal title="找个搭子" subtitle="完成搭搭卡和校园 CBTI 后，哒哒才能按你的校园坐标和社交偏好认真找搭子。" profile={profile} onClose={onClose} onNavigate={onOpenFeature}><section className="beta-empty"><span>⌁</span><h2>{hasProfileCard(profile) ? '先完成校园 CBTI' : '先完成搭搭卡和 CBTI'}</h2><p>{hasProfileCard(profile) ? '完成社交偏好测试后，找搭子会更贴近你。' : '校园坐标和社交偏好是找搭子的基础。'}</p><button className="beta-primary" type="button" onClick={() => onOpenFeature(hasProfileCard(profile) ? 'cbti' : 'profile-card')}>{hasProfileCard(profile) ? '去做校园 CBTI' : '填写我的校园名片'}</button></section></Modal>
  return <Modal title="找个搭子" subtitle="像和哒哒大王聊天一样，慢慢说清楚这次想一起做什么。" profile={profile} onClose={onClose} onNavigate={onOpenFeature}><section className="mini-match-chat"><div className="mini-match-thread" ref={threadRef}>{messages.map((message, index) => <div className={`mini-match-message ${message.sender}`} key={`${message.text}-${index}`}>{message.sender === 'dada' && <span className="beta-avatar">搭</span>}<p>{message.text}</p></div>)}{isThinking && <div className="mini-match-message dada mini-match-thinking"><span className="beta-avatar">搭</span><p>哒哒正在为你整理匹配方向…</p></div>}</div>{canRecommendGroup && <button className="beta-primary" type="button" onClick={() => { onRecommendGroup(); onClose() }}>推送推荐搭子群</button>}{quickReplies.length > 0 && <div className="mini-match-actions">{quickReplies.map((reply) => <button key={reply} type="button" onClick={() => void send(reply)}>{reply}</button>)}</div>}<form className="mini-match-composer" onSubmit={(event) => { event.preventDefault(); void send() }}><input value={draft} disabled={isThinking} onChange={(event) => setDraft(event.target.value)} placeholder="说说时间、地点、活动或你想遇见的人…" /><button type="submit" disabled={isThinking}>发送</button></form></section></Modal>
}

function CompatibilityPanel({ apiKey, profile, onClose, onOpenFeature }: { apiKey: string | null; profile: CampusProfile | null; onClose: () => void; onOpenFeature: (feature: Panel) => void }) {
  const [friendId, setFriendId] = useState('DADA-LX21')
  const [result, setResult] = useState<{ friend: CampusProfile; score: number; pairType: string; orbit: string; detail: string } | null>(null)
  const [analysis, setAnalysis] = useState<CompatibilityAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const readyProfile = profile as CampusProfile

  const generate = () => {
    const friend = mockFriends[friendId.trim().toUpperCase()]
    if (!friend) {
      setResult(null)
      return
    }
    const pairTypes = [
      { pairType: '灵感夜班车', orbit: '✦', detail: '一个总能抛出新点子，一个愿意把点子接住。你们适合在夜里把“随便聊聊”变成一个真的能开始的小计划。' },
      { pairType: '食堂盲盒共同体', orbit: '◉', detail: '你们最强的默契不在大事上，而是“要不要吃点什么”的低成本邀请。稳定一起出现，就是关系最舒服的养分。' },
      { pairType: 'PPT 救火双人组', orbit: '⌘', detail: '一个负责把事情推起来，一个负责让它变得更好看。临近截止日期时，你们会是对方最不想失去的队友。' },
    ]
    const index = (readyProfile.dadaId.charCodeAt(5) + friend.dadaId.charCodeAt(5)) % pairTypes.length
    setResult({ friend, score: 78 + index * 7, ...pairTypes[index] })
    setAnalysis(null)
  }

  useEffect(() => {
    if (!result || !profile || !hasProfileCard(profile) || !hasCbti(profile)) return
    let cancelled = false
    setIsAnalyzing(true)
    const me = `${readyProfile.nickname}｜${readyProfile.school} ${readyProfile.college} ${readyProfile.grade} ${readyProfile.major}｜兴趣：${readyProfile.interests}｜CBTI：${readyProfile.sbtiCode} ${readyProfile.roleName}｜标签：${readyProfile.tags.join('、')}`
    const friend = `${result.friend.nickname}｜${result.friend.school} ${result.friend.college} ${result.friend.grade} ${result.friend.major}｜兴趣：${result.friend.interests}｜CBTI：${result.friend.sbtiCode} ${result.friend.roleName}｜标签：${result.friend.tags.join('、')}`
    const fallback: CompatibilityAnalysis = {
      profile: `**搭搭卡对照**：${result.friend.nickname}是${result.friend.school}${result.friend.college}的${result.friend.grade}，正在把${result.friend.interests}放进日常节奏里。${readyProfile.nickname || '你'}与 Ta 的共同点并不只在兴趣名称，而在都愿意把模糊的想法变成一次真实见面或协作。`,
      resonance: `**CBTI 共振**：${readyProfile.roleName}和${result.friend.roleName}一方更擅长打开话题与可能，一方更容易把气氛、资源或人连接起来。相处时不必追求完全一致，差异恰好能让一段关系既有新鲜感，也有落点。`,
      rhythm: `**关系节奏**：你们适合从有边界的共同任务开始，例如一次逛展、45 分钟自习或小项目拆题。先确认彼此的时间和投入方式，再把“下次见”变成具体时间，而不是留在泛泛的热情里。`,
      guidance: `**搭子建议**：第一次可以选择低压力、可随时结束的活动；结束后用一句具体反馈延续连接，例如“刚才那个想法我回去还在想”。观察对方是否也会主动补充、提议下一次，这比一次见面有多热闹更重要。`,
    }
    if (!apiKey) {
      setAnalysis(fallback)
      setIsAnalyzing(false)
      return () => { cancelled = true }
    }
    askOpenRouter<CompatibilityAnalysis>(apiKey, `你是一位专业、温柔的校园关系分析师。依据两人的搭搭卡和 CBTI，输出严格 JSON，只有 profile、resonance、rhythm、guidance 四个中文字符串字段。每段180-260字，总长度不少于850字；每段有1-2个 **关键词**。像分析两个人的 MBTI 互动与相处节律一样，有逻辑、有层次，但不作绝对预测，不使用传统八字或命理断言。profile 对照搭搭卡，resonance 分析 CBTI 与兴趣互补，rhythm 分析可能的沟通节奏和摩擦点，guidance 给出具体低压力的第一次共同任务与后续建议。\n甲：${me}\n乙：${friend}`, 1400).then((value) => {
      if (!cancelled) setAnalysis(value)
    }).catch(() => {
      if (!cancelled) setAnalysis(fallback)
    }).finally(() => {
      if (!cancelled) setIsAnalyzing(false)
    })
    return () => { cancelled = true }
  }, [apiKey, profile, readyProfile, result])

  if (!hasProfileCard(profile) || !hasCbti(profile)) return <Modal title="好友契合度" subtitle="完成搭搭卡和校园 CBTI 后，才能用校园坐标与社交偏好生成双人轨道图。" profile={profile} onClose={onClose} onNavigate={onOpenFeature}><section className="beta-empty"><span>⌁</span><h2>{hasProfileCard(profile) ? '先完成校园 CBTI' : '先完成搭搭卡和 CBTI'}</h2><p>{hasProfileCard(profile) ? '完成社交偏好测试后，就能生成更贴近的契合度。' : '校园坐标和社交偏好是双人匹配的基础。'}</p><button className="beta-primary" type="button" onClick={() => onOpenFeature(hasProfileCard(profile) ? 'cbti' : 'profile-card')}>{hasProfileCard(profile) ? '去做校园 CBTI' : '填写我的校园名片'}</button></section></Modal>

  return <Modal title="好友契合度" subtitle="测试期可输入 DADA-LX21（林知夏）或 DADA-MG88（马更）。" profile={profile} onClose={onClose} onNavigate={onOpenFeature}>
    <section className="compatibility-panel"><div className="id-row"><label>我的 DADA-ID<input value={readyProfile.dadaId} disabled /></label><label>朋友的 DADA-ID<input value={friendId} onChange={(event) => setFriendId(event.target.value)} /></label></div><button className="beta-primary" type="button" onClick={generate}>生成双人校园轨道图</button>{!result && friendId && !mockFriends[friendId.toUpperCase()] && <p className="beta-error">这个测试 ID 暂未在 mock 好友目录中。</p>}{result && <section className="compatibility-result"><div className="orbit-visual"><span className="orbit-ring" /><span className="orbit-person one">{readyProfile.nickname.slice(0, 1) || '我'}</span><span className="orbit-person two">{result.friend.nickname.slice(0, 1)}</span><strong>{result.orbit}</strong></div><span className="beta-kicker">校园契合度 {result.score}%</span><h2>{result.pairType}</h2><p>{readyProfile.roleName} × {result.friend.roleName}</p><article className="compatibility-buddy-card"><small>对方的搭搭卡</small><strong>{result.friend.nickname} · {result.friend.dadaId}</strong><p>{[result.friend.school, result.friend.college, result.friend.grade, result.friend.major].join(' · ')}</p><p>{result.friend.interests}</p><div><b>{result.friend.sbtiCode}</b><span>{result.friend.roleName}</span></div><em>{result.friend.tags.map((tag) => `#${tag}`).join(' ')}</em></article>{isAnalyzing ? <p className="tarot-loading">哒哒正在对照两张搭搭卡与 CBTI 节奏…</p> : analysis && <div className="compatibility-analysis">{[['搭搭卡', analysis.profile], ['共振', analysis.resonance], ['节奏', analysis.rhythm], ['建议', analysis.guidance]].map(([label, text]) => <p key={label}><small>{label}</small><RichTarotText text={text} /></p>)}</div>}</section>}</section>
  </Modal>
}
