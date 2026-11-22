import { translate } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { adoptFillerLanguage, normalizeRules } from '@shared/defects'
import {
  CURRENT_PROJECT_VERSION,
  migrateProject,
  type RawProject
} from '@shared/projectMigrations'
import type {
  MediaInfo,
  Peaks,
  Project,
  ProjectSummary,
  Settings,
  Transcript
} from '@shared/types'
import { projectsDir } from './paths'
import { currentUiLanguage } from './uiLanguage'

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

function metaOf(project: Project): ProjectMeta & { schemaVersion: number } {
  // Drop any stale version a caller may have carried in memory, then stamp the
  // current one: everything written by this build is already migrated.
  const { transcript: _transcript, ...meta } = project
  delete (meta as { schemaVersion?: number }).schemaVersion
  return { ...meta, schemaVersion: CURRENT_PROJECT_VERSION }
}

export async function createProject(
  media: MediaInfo,
  duration: number,
  settings: Settings
): Promise<Project> {
  const id = randomUUID()
  const now = new Date().toISOString()
  const name =
    basename(media.path, extname(media.path)).trim() ||
    translate(currentUiLanguage(), 'project.defaultName')

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
    cutOverrides: {},
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
  const raw = JSON.parse(await readFile(projectFile(id), 'utf8')) as RawProject

  // Read the transcript first: automatic defect ids in the metadata can only be
  // migrated against the words they were detected on.
  let transcript: Transcript | undefined
  try {
    transcript = JSON.parse(await readFile(transcriptFile(id), 'utf8')) as Transcript
  } catch {
    transcript = undefined
  }

  const migrated = migrateProject(raw, transcript)
  const meta = migrated.project

  const project = {
    ...meta,
    marks: meta.marks ?? [],
    // Projects created by older builds may not contain every rule field.
    rules: adoptFillerLanguage(normalizeRules(meta.rules, meta.language), meta.language),
    cutOverrides: meta.cutOverrides ?? {},
    confirmedDefectIds: meta.confirmedDefectIds ?? [],
    dismissedDefectIds: meta.dismissedDefectIds ?? [],
    dismissedMarks: meta.dismissedMarks ?? [],
    defectNotes: meta.defectNotes ?? {},
    bookmarks: Array.isArray(meta.bookmarks) ? meta.bookmarks : [],
    transcriptComplete: meta.transcriptComplete ?? false
  } as Project

  // Upgrade the file once, so a migrated project is not re-processed on every
  // open. A failure here must not lose the user's project: the in-memory
  // result is still returned.
  if (migrated.migrated) {
    await writeJson(projectFile(id), metaOf(project)).catch(() => undefined)
  }

  if (transcript) {
    project.transcript = transcript
  } else {
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
  const meta = JSON.parse(await readFile(projectFile(id), 'utf8')) as ProjectMeta & {
    schemaVersion?: number
  }
  meta.transcriptComplete = complete
  meta.updatedAt = new Date().toISOString()
  // Automatic defect ids are stable now, so a fresh transcript no longer
  // renumbers the user's review state. It is still cleared when the whole
  // transcript is replaced: the old matches may be gone or split differently,
  // and a stale id would point at a different defect.
  if (resetReview) {
    meta.confirmedDefectIds = []
    meta.dismissedDefectIds = []
    meta.defectNotes = {}
    meta.cutOverrides = {}
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
