export type IdFactory = () => string

export interface Player {
  id: string
  name: string
  avatar: string
  score: number
  xp: number
  last_claim_at: number | null
  comeback_week_key: string
}

export type TaskStatus = 'open' | 'done' | 'burned' | 'scheduled'

export interface Task {
  id: string
  title: string
  emoji: string
  base_points: number
  created_at: number
  deadline: number
  status: TaskStatus
  claimed_by: string | null
  awarded_points: number | null
  finished_at: number | null
  repeat_hours: number | null
  interval_hours: number | null
  fuse_hours: number | null
  appear_at: number | null
}

export interface Reaction {
  player_id: string
  emoji: string
}

export interface FamEvent {
  id: string
  kind: string
  text: string
  at: number
  reactions: Reaction[]
}

export interface SeasonResult {
  week_key: string
  p1_score: number
  p2_score: number
  winner: string | null
}

export interface Achievement {
  id: string
  player_id: string
  key: string
  title: string
  emoji: string
  at: number
}

export interface FamilyShelfItem {
  id: string
  title: string
  emoji: string
  base_points: number
  hours: number
  repeat: boolean
  interval_hours: number | null
}

export type MemorableDateKind = 'anniversary' | 'meeting' | 'birthday' | 'custom'

export interface MemorableDate {
  id: string
  title: string
  date: string
  kind: MemorableDateKind
}

export interface Db {
  /** Internal one-time content bootstrap marker. Never exposed by StateResponse. */
  content_seed_version?: number
  players: Player[]
  tasks: Task[]
  events: FamEvent[]
  week_key: string
  seasons: SeasonResult[]
  achievements: Achievement[]
  week_burns: number
  week_claims: number
  family_shelf: FamilyShelfItem[]
  memorable_dates: MemorableDate[]
}

export interface NewTaskRequest {
  title: string
  emoji?: string | null
  base_points?: number | null
  hours?: number | null
  repeat?: boolean | null
  interval_hours?: number | null
}

export interface ClaimRequest {
  player_id: string
}

export interface RenameRequest {
  name: string
}

export interface ReactionRequest {
  player_id: string
  emoji: string
}

export interface MemorableDateRequest {
  title: string
  date: string
  kind: string
}

export interface ClaimResponse {
  points: number
  task_points: number
  comeback: number
  players: Player[]
  combo_count: number
  combo_mult: number
  new_achievements: Achievement[]
}

export interface StateResponse {
  players: Player[]
  tasks: Task[]
  events: FamEvent[]
  week_key: string
  seasons: SeasonResult[]
  achievements: Achievement[]
  history: Task[]
  family_shelf: FamilyShelfItem[]
  memorable_dates: MemorableDate[]
  server_now: number
}
