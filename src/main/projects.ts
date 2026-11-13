import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { normalizeRules } from '@shared/defects'
import type {
  ManualMark,
  MediaInfo,
  Peaks,
  Project,
  ProjectSummary,
  Settings,
  Transcript
} from '@shared/types'
import { projectsDir } from './paths'

export interface LoadedProject {
  project: Project
  peaks: Peaks | null
}

function projectDir(id: string): string {
  return join(projectsDir(), id)
}

function projectFile(id: string): string {
  return join(projectDir(id), 'project.json')
}

function transcriptFile(id: string): string {
  return join(projectDir(id), 'transcript.json')
}

function peaksFile(id: string): string {
  return join(projectDir(id), 'peaks.json')
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(value), 'utf8')
  await rename(temporary, path)
}

type ProjectMeta = Omit<Project, 'transcript'>

/** Older project files stored a single `reviewedDefectIds` list. */
type LegacyProjectMeta = Partial<ProjectMeta> & { reviewedDefectIds?: string[] }

function metaOf(project: Project): ProjectMeta {
  const { transcript: _transcript, ...meta } = project
  return meta
}

export async function createProject(
  media: MediaInfo,
  duration: number,
  settings: Settings
): Promise<Project> {
  const id = randomUUID()
  const now = new Date().toISOString()
  const name = basename(media.path, extname(media.path)).trim() || 'Вебинар'

  const project: Project = {
    id,
    name,
    video: media,
    duration,
    language: settings.language,
    modelId: settings.modelId,
    backend: settings.backend,
    createdAt: now,
    updatedAt: now,
    marks: [],
    rules: settings.rules,
    defectOverrides: {},
    confirmedDefectIds: [],
    dismissedDefectIds: [],
    dismissedMarks: [],
    defectNotes: {},
    bookmarks: [],
    transcriptComplete: false
  }

  await mkdir(projectDir(id), { recursive: true })
  await writeJson(projectFile(id), metaOf(project))
  return project
}

export async function loadProject(id: string): Promise<LoadedProject> {
  const raw = JSON.parse(await readFile(projectFile(id), 'utf8')) as ProjectMeta & {
    reviewedDefectIds?: string[]
    confirmedDefectIds?: string[]
    dismissedDefectIds?: string[]
    dismissedMarks?: ManualMark[]
  }
  const { reviewedDefectIds: legacyReviewed, ...meta } = raw
  // Old builds had one "reviewed" flag whose meaning was closer to the new
  // "deleted": a checked item was considered not a defect and played normally.
  // Translate it once instead of inverting the user's decision.
  const hasNewState =
    Array.isArray(meta.confirmedDefectIds) ||
    Array.isArray(meta.dismissedDefectIds) ||
    Array.isArray(meta.dismissedMarks)
  const confirmedDefectIds = hasNewState ? meta.confirmedDefectIds ?? [] : []
  let dismissedDefectIds = hasNewState
    ? [...(meta.dismissedDefectIds ?? [])]
    : [...(legacyReviewed ?? [])].filter((defectId) => !defectId.startsWith('manual-'))

  // Manual deletions live in an archive with the full mark. Older builds stored
  // their defect IDs in dismissedDefectIds, so move those marks once.
  const manualDismissedIds = new Set<string>()
  for (const defectId of legacyReviewed ?? []) {
    if (defectId.startsWith('manual-')) manualDismissedIds.add(defectId)
  }
  for (const defectId of dismissedDefectIds) {
    if (defectId.startsWith('manual-')) manualDismissedIds.add(defectId)
  }
  dismissedDefectIds = dismissedDefectIds.filter((defectId) => !defectId.startsWith('manual-'))

  const sourceMarks = meta.marks ?? []
  const dismissedMarks: ManualMark[] = hasNewState ? [...(meta.dismissedMarks ?? [])] : []
  const archivedIds = new Set(dismissedMarks.map((mark) => mark.id))
  const marks: ManualMark[] = []
  for (const mark of sourceMarks) {
    if (archivedIds.has(mark.id)) continue
    const singleId = `manual-${mark.id}`
    const groupId = mark.groupId ? `manual-group-${mark.groupId}` : null
    if (manualDismissedIds.has(singleId) || (groupId && manualDismissedIds.has(groupId))) {
      dismissedMarks.push(mark)
      archivedIds.add(mark.id)
    } else {
      marks.push(mark)
    }
  }

  const project: Project = {
    ...meta,
    marks,
    // Projects created by older builds may not contain every rule field.
    rules: normalizeRules(meta.rules),
    defectOverrides: meta.defectOverrides ?? {},
    confirmedDefectIds,
    dismissedDefectIds,
    dismissedMarks,
    defectNotes: meta.defectNotes ?? {},
    bookmarks: Array.isArray(meta.bookmarks) ? meta.bookmarks : [],
    transcriptComplete: meta.transcriptComplete ?? false
  }

  try {
    project.transcript = JSON.parse(await readFile(transcriptFile(id), 'utf8')) as Transcript
  } catch {
    project.transcript = undefined
    project.transcriptComplete = false
  }

  let peaks: Peaks | null = null
  try {
    peaks = JSON.parse(await readFile(peaksFile(id), 'utf8')) as Peaks
  } catch {
    peaks = null
  }

  return { project, peaks }
}

export async function saveProject(project: Project): Promise<void> {
  await mkdir(projectDir(project.id), { recursive: true })
  const meta = metaOf({ ...project, updatedAt: new Date().toISOString() })
  await writeJson(projectFile(project.id), meta)
}

export async function writeTranscript(
  id: string,
  transcript: Transcript,
  complete: boolean,
  resetReview = true
): Promise<void> {
  await mkdir(projectDir(id), { recursive: true })
  await writeJson(transcriptFile(id), transcript)
  const meta = JSON.parse(await readFile(projectFile(id), 'utf8')) as LegacyProjectMeta & {
    reviewedDefectIds?: string[]
  }
  meta.transcriptComplete = complete
  meta.updatedAt = new Date().toISOString()
  // Defect ids are derived from the transcript order, so old confirmation,
  // deletion and note state would silently point at different defects after
  // re-recognition. Partial writes keep the state of the already visible prefix.
  if (resetReview) {
    meta.confirmedDefectIds = []
    meta.dismissedDefectIds = []
    meta.defectNotes = {}
    meta.defectOverrides = {}
    delete meta.reviewedDefectIds
  }
  await writeJson(projectFile(id), meta)
}

export async function savePeaks(id: string, peaks: Peaks): Promise<void> {
  await mkdir(projectDir(id), { recursive: true })
  await writeJson(peaksFile(id), peaks)
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const root = projectsDir()
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }

  const summaries: ProjectSummary[] = []
  for (const entry of entries) {
    try {
      const meta = JSON.parse(
        await readFile(projectFile(entry), 'utf8')
      ) as ProjectMeta
      const transcriptInfo = await stat(transcriptFile(entry)).catch(() => null)
      summaries.push({
        id: typeof meta.id === 'string' ? meta.id : entry,
        name: typeof meta.name === 'string' && meta.name ? meta.name : entry,
        videoName: meta.video?.name ?? '',
        duration: meta.duration ?? 0,
        updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : '',
        hasTranscript: transcriptInfo !== null,
        transcriptComplete: Boolean(meta.transcriptComplete && transcriptInfo)
      })
    } catch {
      // Ignore half-written or unrelated directories.
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteProject(id: string): Promise<void> {
  await rm(projectDir(id), { recursive: true, force: true })
}
