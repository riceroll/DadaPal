import { useMemo, useState } from 'react'

type Feature = 'match' | 'sbti' | 'tarot' | 'compatibility' | 'answer-book'
type Panel = Exclude<Feature, 'match' | 'answer-book'> | null
type Sender = 'dada' | 'user'

type BetaMessage =
  | { id: string; kind: 'text'; sender: Sender; text: string }
  | { id: string; kind: 'feature'; feature: Feature }

type CampusProfile = {
  nickname: string
  school: string
  major: string
  grade: string
  interests: string
  sbtiCode: string
  roleName: string
  tags: string[]
  dadaId: string
}

type TarotCard = {
  title: string
  icon: string
  line: string
  tone: 'lemon' | 'mint' | 'coral'
}

const STORAGE_KEY = 'dadapal-beta-v1'

const featureCopy: Record<Feature, { icon: string; title: string; subtitle: string; button: string }> = {
  match: { icon: '✦', title: '找搭子 / 找朋友', subtitle: '把你的校园近况变成一次真诚连接', button: '开始找人' },
  sbti: { icon: '▦', title: '校园 SBTI', subtitle: '做 6 道题，生成你的校园社交人格卡', button: '去做 SBTI' },
  tarot: { icon: '☾', title: '校园命运牌', subtitle: '问一个大学生活的问题，抽三张牌', button: '抽一把牌' },
  compatibility: { icon: '∞', title: '好友默契度', subtitle: '输入朋友 DADA-ID，解锁你们的搭子关系图', button: '测默契度' },
  'answer-book': { icon: '✎', title: '校园答案之书', subtitle: '正在装订中，下一轮 Beta 开放', button: '即将解锁' },
}

const initialMessages: BetaMessage[] = [
  {
    id: 'beta-welcome',
    kind: 'text',
    sender: 'dada',
    text: '嗨嗨，我是哒哒 Beta 👑 我当然可以继续帮你找搭子、找朋友和找群；但今天也可以先一起玩点校园小功能。你想从哪里开始？',
  },
  { id: 'beta-sbti', kind: 'feature', feature: 'sbti' },
  { id: 'beta-tarot', kind: 'feature', feature: 'tarot' },
  { id: 'beta-compatibility', kind: 'feature', feature: 'compatibility' },
  { id: 'beta-match', kind: 'feature', feature: 'match' },
]

const questions = [
  { question: '开学第一顿饭，你更像哪一种？', options: [['食堂盲盒启动，难吃也是体验', 'explore'], ['先查评分最高的店，第一口不能输', 'plan'], ['你们决定，我负责把大家聊熟', 'social']] },
  { question: '临时组队做项目时，你通常？', options: [['先把任务拆开，给每个人一个出口', 'plan'], ['先看大家会什么，再把人连起来', 'social'], ['先做一个能跑的版本，边做边改', 'explore']] },
  { question: '周末突然空出来半天，你会？', options: [['临时约个局，走到哪算哪', 'social'], ['去没去过的地方，给生活开个新副本', 'explore'], ['安静清理待办，把下周铺好', 'plan']] },
  { question: '朋友卡住时，你的第一反应？', options: [['把问题听完整，先陪着再说', 'social'], ['一起想三个离谱但可行的方案', 'explore'], ['帮 TA 把下一步写得具体一点', 'plan']] },
  { question: '一个你会认真加入的校园活动？', options: [['黑客松 / 项目冲刺', 'explore'], ['桌游局 / 逛展 / 夜聊', 'social'], ['工作坊 / 分享会 / 组织策划', 'plan']] },
  { question: '你想被朋友怎么形容？', options: [['靠谱又有主意', 'plan'], ['好玩、有火花', 'explore'], ['好约、很懂人', 'social']] },
] as const

const tarotDeck: TarotCard[] = [
  { title: '食堂盲盒', icon: '饭', line: '一顿随便吃点，可能会打开固定饭点。', tone: 'lemon' },
  { title: '图书馆空位', icon: '书', line: '有人刚好坐在你的日常旁边。', tone: 'mint' },
  { title: '雨天共伞', icon: '伞', line: '天气会替嘴硬的人制造借口。', tone: 'coral' },
  { title: '操场夜风', icon: '夜', line: '说好走一圈，最后走了很久。', tone: 'mint' },
  { title: '跑调副歌', icon: '麦', line: '真诚比唱准更容易被记住。', tone: 'lemon' },
  { title: '黑客松泡面', icon: '码', line: '临时组队，也可能通宵结义。', tone: 'coral' },
]

const mockFriends: Record<string, CampusProfile> = {
  'DADA-LX21': { nickname: '林知夏', school: '同济大学', major: '工业设计', grade: '大三', interests: 'AI、交互设计、作品集、逛展', sbtiCode: 'SE-P', roleName: '灵感夜班车', tags: ['灵感捕手', '跨界搭子', '逛展雷达'], dadaId: 'DADA-LX21' },
  'DADA-MG88': { nickname: '马更', school: '复旦大学', major: '新闻学', grade: '大二', interests: '跑步、播客、校园活动', sbtiCode: 'SC-E', roleName: '人群点火器', tags: ['活动发动机', '听故事的人', '临场不怯'], dadaId: 'DADA-MG88' },
}

function loadProfile(): CampusProfile | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? (JSON.parse(saved) as CampusProfile) : null
  } catch {
    return null
  }
}

function saveProfile(profile: CampusProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
}

function makeDadaId() {
  return `DADA-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function makePersona(selected: string[]): Pick<CampusProfile, 'sbtiCode' | 'roleName' | 'tags'> {
  const score = selected.reduce<Record<string, number>>((result, key) => ({ ...result, [key]: (result[key] ?? 0) + 1 }), {})
  const ordered = ['social', 'explore', 'plan'].sort((a, b) => (score[b] ?? 0) - (score[a] ?? 0))
  const code = `${ordered[0]?.[0].toUpperCase() ?? 'S'}${ordered[1]?.[0].toUpperCase() ?? 'E'}-BETA`
  const personas: Record<string, Pick<CampusProfile, 'roleName' | 'tags'>> = {
    social: { roleName: '校园连接器', tags: ['破冰自然', '饭点收集者', '关系保温员'] },
    explore: { roleName: '灵感夜班车', tags: ['新点子雷达', '副本探索者', '敢先开口'] },
    plan: { roleName: '靠谱策划组长', tags: ['行动派', '项目收束器', '稳定输出'] },
  }
  return { sbtiCode: code, ...personas[ordered[0] ?? 'social'] }
}

function pickCards() {
  const shuffled = [...tarotDeck].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 3)
}

function FeatureCard({ feature, onOpen }: { feature: Feature; onOpen: (feature: Feature) => void }) {
  const copy = featureCopy[feature]
  const disabled = feature === 'answer-book'
  return (
    <article className={`beta-feature-card ${disabled ? 'is-soon' : ''}`}>
      <span className="beta-feature-icon">{copy.icon}</span>
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.subtitle}</p>
        <button type="button" disabled={disabled} onClick={() => onOpen(feature)}>{copy.button}</button>
      </div>
    </article>
  )
}

export function BetaApp() {
  const [messages, setMessages] = useState<BetaMessage[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  const [profile, setProfile] = useState<CampusProfile | null>(loadProfile)

  const append = (message: BetaMessage) => setMessages((current) => [...current, message])

  const openFeature = (feature: Feature) => {
    if (feature === 'match') {
      append({ id: crypto.randomUUID(), kind: 'text', sender: 'dada', text: '找搭子当然没问题～Beta 里会带着你的校园资料和 SBTI 去做更有趣的连接；当前测试版先请你完成 SBTI 或资料卡，我们马上接着扩展真实匹配。' })
      return
    }
    if (feature === 'answer-book') return
    setPanel(feature)
  }

  const sendMessage = () => {
    const text = draft.trim()
    if (!text) return
    append({ id: crypto.randomUUID(), kind: 'text', sender: 'user', text })
    setDraft('')
    append({ id: crypto.randomUUID(), kind: 'text', sender: 'dada', text: '我收到啦。这个 Beta 先把几个能力做成入口卡，你可以直接点一张开始玩；下一轮会接上模型，让我根据你这句话自然带你去对应功能。' })
  }

  const onProfileReady = (nextProfile: CampusProfile) => {
    setProfile(nextProfile)
    saveProfile(nextProfile)
    setPanel(null)
    append({ id: crypto.randomUUID(), kind: 'text', sender: 'dada', text: `你的校园 SBTI「${nextProfile.roleName}」和 DADA-ID 已经生成啦。现在你可以去抽命运牌，或者拿 ${nextProfile.dadaId} 和朋友测默契度。` })
    append({ id: crypto.randomUUID(), kind: 'feature', feature: 'tarot' })
    append({ id: crypto.randomUUID(), kind: 'feature', feature: 'compatibility' })
  }

  const resetBeta = () => {
    localStorage.removeItem(STORAGE_KEY)
    setProfile(null)
    setMessages(initialMessages)
    setPanel(null)
  }

  return (
    <main className="beta-shell">
      <aside className="beta-side">
        <a className="beta-back" href="../">← 返回 DadaPal 主版</a>
        <div className="beta-logo"><span>搭</span><div><strong>Dada Beta</strong><small>校园全能好朋友</small></div></div>
        <p>找搭子仍是主线；人格、塔罗和好友玩法，让认识彼此更有意思。</p>
        <div className="beta-menu">
          {(Object.keys(featureCopy) as Feature[]).filter((feature) => feature !== 'answer-book').map((feature) => (
            <button key={feature} type="button" onClick={() => openFeature(feature)}>{featureCopy[feature].icon} {featureCopy[feature].title}</button>
          ))}
        </div>
        <div className="beta-test-note"><strong>内测工具箱</strong><span>{profile ? `已保存：${profile.dadaId}` : '先做一次 SBTI，开启更多玩法'}</span><button type="button" onClick={resetBeta}>重置本机测试数据</button></div>
      </aside>

      <section className="beta-phone" aria-label="DadaPal Beta 聊天">
        <header className="beta-header"><div><strong>AAA 哒哒大王 👑</strong><small>Beta · 校园全能好朋友</small></div><span className="beta-live">测试中</span></header>
        <div className="beta-feed">
          <p className="beta-time">DadaPal Beta 内测</p>
          {messages.map((message) => message.kind === 'text' ? (
            <div className={`beta-message ${message.sender}`} key={message.id}>
              {message.sender === 'dada' && <span className="beta-avatar">A</span>}
              <p>{message.text}</p>
            </div>
          ) : <div className="beta-card-row" key={message.id}><span className="beta-avatar">A</span><FeatureCard feature={message.feature} onOpen={openFeature} /></div>)}
        </div>
        <form className="beta-composer" onSubmit={(event) => { event.preventDefault(); sendMessage() }}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="说说你现在想做什么…" /><button type="submit">发送</button></form>
      </section>

      {panel === 'sbti' && <SbtiPanel existingProfile={profile} onClose={() => setPanel(null)} onComplete={onProfileReady} />}
      {panel === 'tarot' && <TarotPanel profile={profile} onClose={() => setPanel(null)} />}
      {panel === 'compatibility' && <CompatibilityPanel profile={profile} onClose={() => setPanel(null)} onNeedProfile={() => setPanel('sbti')} />}
    </main>
  )
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="beta-overlay" role="dialog" aria-modal="true" aria-label={title}><section className="beta-modal"><header><div><span className="beta-kicker">DadaPal Beta</span><h1>{title}</h1><p>{subtitle}</p></div><button className="beta-close" type="button" onClick={onClose}>×</button></header>{children}</section></div>
}

function SbtiPanel({ existingProfile, onClose, onComplete }: { existingProfile: CampusProfile | null; onClose: () => void; onComplete: (profile: CampusProfile) => void }) {
  const [step, setStep] = useState(existingProfile ? questions.length : 0)
  const [answers, setAnswers] = useState<string[]>([])
  const [form, setForm] = useState({ nickname: existingProfile?.nickname ?? '', school: existingProfile?.school ?? '', major: existingProfile?.major ?? '', grade: existingProfile?.grade ?? '', interests: existingProfile?.interests ?? '' })
  const completed = step >= questions.length
  const question = questions[Math.min(step, questions.length - 1)]
  const persona = useMemo(() => makePersona(answers), [answers])

  const choose = (value: string) => {
    setAnswers((current) => [...current, value])
    setStep((current) => current + 1)
  }

  const submit = () => {
    const nextProfile: CampusProfile = { ...form, ...persona, dadaId: existingProfile?.dadaId ?? makeDadaId() }
    onComplete(nextProfile)
  }

  return <Modal title="校园 SBTI" subtitle="不是心理测量，是一张更好认识你的校园社交人格卡。" onClose={onClose}>
    {!completed ? <section className="sbti-question"><div className="beta-progress"><span style={{ width: `${(step / questions.length) * 100}%` }} /></div><small>{step + 1} / {questions.length}</small><h2>{question.question}</h2><div className="sbti-options">{question.options.map(([label, value]) => <button key={value} type="button" onClick={() => choose(value)}>{label}</button>)}</div></section> : <section className="sbti-profile"><div className="beta-persona-preview"><span>{persona.sbtiCode}</span><h2>{persona.roleName}</h2><p>{persona.tags.join(' · ')}</p></div><p className="beta-form-note">补一点资料，名片和后续匹配都会更准。你可在后续版本控制公开范围。</p><div className="beta-form-grid"><label>昵称<input value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} placeholder="例如：小周" /></label><label>学校<input value={form.school} onChange={(event) => setForm({ ...form, school: event.target.value })} placeholder="例如：交大" /></label><label>专业<input value={form.major} onChange={(event) => setForm({ ...form, major: event.target.value })} placeholder="例如：计算机" /></label><label>年级<input value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })} placeholder="例如：大三" /></label></div><label className="beta-wide-label">最近喜欢 / 正在做什么<input value={form.interests} onChange={(event) => setForm({ ...form, interests: event.target.value })} placeholder="例如：网球、AI 项目、逛展" /></label><button className="beta-primary" type="button" onClick={submit}>生成我的校园人格卡</button></section>}
  </Modal>
}

function TarotPanel({ profile, onClose }: { profile: CampusProfile | null; onClose: () => void }) {
  const [question, setQuestion] = useState('大学的第一个 crush 会在哪里出现？')
  const [cards, setCards] = useState<TarotCard[] | null>(null)
  return <Modal title="校园命运牌" subtitle="问一个校园生活的问题，抽三张轻松一点的命运牌。" onClose={onClose}>
    <section className="tarot-panel"><label className="beta-wide-label">我想问<input value={question} onChange={(event) => setQuestion(event.target.value)} /></label><button className="beta-primary" type="button" onClick={() => setCards(pickCards())}>抽取三张校园命运牌</button>{cards && <><div className="tarot-spread">{cards.map((card, index) => <article className={`tarot-card ${card.tone}`} key={`${card.title}-${index}`}><small>{['起点', '触发', '走向'][index]}</small><span>{card.icon}</span><h3>{card.title}</h3><p>{card.line}</p></article>)}</div><article className="tarot-reading"><strong>{question || '你的校园问题'}</strong><p>{profile ? `${profile.roleName} 的你，` : ''}{cards[0].line} {cards[1].line} 最后，{cards[2].line} 不用急着验证，先给生活留一个“刚好”的位置。</p></article></>}</section>
  </Modal>
}

function CompatibilityPanel({ profile, onClose, onNeedProfile }: { profile: CampusProfile | null; onClose: () => void; onNeedProfile: () => void }) {
  const [friendId, setFriendId] = useState('DADA-LX21')
  const [result, setResult] = useState<{ friend: CampusProfile; score: number; pairType: string; orbit: string; detail: string } | null>(null)
  if (!profile) return <Modal title="好友默契度" subtitle="先生成你的 SBTI 和资料卡，才能把两个人的校园坐标放到一起。" onClose={onClose}><section className="beta-empty"><span>∞</span><h2>你的校园坐标还没生成</h2><p>完成一次校园 SBTI 后，就能用 DADA-ID 测你和朋友是哪一种搭子。</p><button className="beta-primary" type="button" onClick={onNeedProfile}>先做校园 SBTI</button></section></Modal>

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
    const index = (profile.dadaId.charCodeAt(5) + friend.dadaId.charCodeAt(5)) % pairTypes.length
    setResult({ friend, score: 78 + index * 7, ...pairTypes[index] })
  }

  return <Modal title="好友默契度" subtitle="测试期可输入 DADA-LX21（林知夏）或 DADA-MG88（马更）。" onClose={onClose}>
    <section className="compatibility-panel"><div className="id-row"><label>我的 DADA-ID<input value={profile.dadaId} disabled /></label><label>朋友的 DADA-ID<input value={friendId} onChange={(event) => setFriendId(event.target.value)} /></label></div><button className="beta-primary" type="button" onClick={generate}>生成双人校园轨道图</button>{!result && friendId && !mockFriends[friendId.toUpperCase()] && <p className="beta-error">这个测试 ID 暂未在 mock 好友目录中。</p>}{result && <section className="compatibility-result"><div className="orbit-visual"><span className="orbit-ring" /><span className="orbit-person one">{profile.nickname.slice(0, 1) || '我'}</span><span className="orbit-person two">{result.friend.nickname.slice(0, 1)}</span><strong>{result.orbit}</strong></div><span className="beta-kicker">校园契合度 {result.score}%</span><h2>{result.pairType}</h2><p>{profile.roleName} × {result.friend.roleName}</p><article><strong>为什么你们很搭</strong><p>{result.detail}</p><strong>第一场共同任务</strong><p>约一次 45 分钟的校园散步或饭局：每人带一个最近想做的小点子，不需要立刻合作，只负责把彼此讲兴奋。</p></article></section>}</section>
  </Modal>
}
