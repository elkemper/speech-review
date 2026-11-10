import { spawn } from 'node:child_process'

export interface RunProcessOptions {
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface RunProcessResult {
  stdout: string
  stderr: string
  code: number
}

export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {}
): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    let stdout = ''
    let stderr = ''

    const onAbort = (): void => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    }

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (buffer: Buffer) => {
      const chunk = buffer.toString('utf8')
      stdout += chunk
      options.onStdout?.(chunk)
    })

    child.stderr?.on('data', (buffer: Buffer) => {
      const chunk = buffer.toString('utf8')
      stderr += chunk
      options.onStderr?.(chunk)
    })

    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })

    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort)
      if (options.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      resolve({ stdout, stderr, code: code ?? -1 })
    })
  })
}

export function tail(text: string, lines = 20): string {
  return text.trim().split('\n').slice(-lines).join('\n')
}
