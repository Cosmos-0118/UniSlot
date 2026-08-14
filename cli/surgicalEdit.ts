import * as p from '@clack/prompts'
import chalk from 'chalk'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertReadableFile,
  assertSnapshotFolder,
  pickEnrollmentFile,
  pickOutputFolder,
  pickPreviousOutputFolder,
} from './fileDialog.ts'
import { bannerAnimated, outroSuccess, playWriteSweep, showPanel } from './ui.ts'
import { spinOk, spinWarn } from './theme.ts'
import {
  runFixPipeline,
  type FixCourseMode,
  type FixPipelineResult,
} from '../src/modules/scheduling/pipeline/fixRun.ts'
import {
  listStudentCourses,
  StudentCourseEditError,
} from '../src/modules/scheduling/merge/studentCourseEdit.ts'
import { cleanCourseCode, cleanRegisterNumber } from '../src/modules/scheduling/parse/parser.ts'
import { loadSchedulingSnapshot, type SchedulingSnapshot } from '../src/modules/scheduling/merge/snapshot.ts'
import {
  inferAllowSaturdayFromSnapshot,
  inferSaturdayExtrasFromSnapshot,
} from '../src/modules/scheduling/merge/enrollmentDelta.ts'

async function writeFixExports(outDir: string, result: FixPipelineResult): Promise<string[]> {
  await mkdir(outDir, { recursive: true })
  const written: string[] = []
  if (result.scheduleXlsx) {
    const fp = path.join(outDir, 'schedule.xlsx')
    await writeFile(fp, Buffer.from(result.scheduleXlsx))
    written.push(fp)
  }
  if (result.clashXlsx) {
    const fp = path.join(outDir, 'clash-report.xlsx')
    await writeFile(fp, Buffer.from(result.clashXlsx))
    written.push(fp)
  }
  if (result.courseEmailsXlsx) {
    const fp = path.join(outDir, 'course-emails.xlsx')
    await writeFile(fp, Buffer.from(result.courseEmailsXlsx))
    written.push(fp)
  }
  if (result.enrollmentXlsx) {
    const fp = path.join(outDir, 'enrollment.xlsx')
    await writeFile(fp, Buffer.from(result.enrollmentXlsx))
    written.push(fp)
  }
  if (result.schedulingSnapshot) {
    const fp = path.join(outDir, 'snapshot.json')
    await writeFile(fp, JSON.stringify(result.schedulingSnapshot, null, 2), 'utf8')
    written.push(fp)
  }
  if (result.editReport) {
    const fp = path.join(outDir, 'fix-report.json')
    await writeFile(fp, JSON.stringify(result.editReport, null, 2), 'utf8')
    written.push(fp)
  }
  if (result.runLog.length) {
    const fp = path.join(outDir, 'run-log.json')
    await writeFile(fp, JSON.stringify(result.runLog, null, 2), 'utf8')
    written.push(fp)
  }
  const report = result.editReport
  const summary = {
    mode: report?.mode ?? 'fix-course',
    status: result.solver_status,
    message: result.solver_message,
    clash_weight: result.stats?.scheduling?.total_clash_weight,
    red_students: result.clashReport?.students_with_clashes,
    red_before: report?.red_before,
    red_after: report?.red_after,
    register_number: report?.register_number,
    removed_course: report?.removed_course,
    added_course: report?.added_course,
    created_new_course: report?.created_new_course ?? false,
    placement_method: report?.placement_method ?? 'existing',
    new_course_slot: report?.new_course_slot,
    pruned_courses: report?.pruned_courses ?? [],
    student_removed: report?.student_removed ?? false,
    infeasible: result.infeasible ?? false,
    allow_saturday_for_math: result.allowSaturdayForMath,
    saturday_extra_course_codes: result.saturdayExtraCourseCodes ?? [],
  }
  const summaryPath = path.join(outDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  written.push(summaryPath)
  return written
}

const SWITCH_STUDENT = '__switch_student__'

type SessionNext = 'same-student' | 'other-student' | 'done'

function courseSelectOptions(
  courses: { course_code: string; course_title: string }[],
  includeSwitch: boolean,
): { value: string; label: string }[] {
  const options = courses.map((c) => ({
    value: c.course_code,
    label: c.course_title ? `${c.course_code} — ${c.course_title}` : c.course_code,
  }))
  if (includeSwitch) {
    options.push({ value: SWITCH_STUDENT, label: 'Choose a different student' })
  }
  return options
}

async function promptSessionNext(args: {
  mode: FixCourseMode
  register: string
  remaining: number
  studentRemoved: boolean
}): Promise<SessionNext> {
  const verb = args.mode === 'fix-course' ? 'Fix' : 'Drop'
  const options: { value: SessionNext; label: string }[] = []
  if (!args.studentRemoved && args.remaining > 0) {
    options.push({
      value: 'same-student',
      label: `${verb} another course for ${args.register} (${args.remaining} left)`,
    })
  }
  options.push(
    { value: 'other-student', label: `${verb} a course for a different student` },
    { value: 'done', label: 'Done' },
  )
  const selected = await p.select({
    message: args.studentRemoved
      ? `${args.register} has no remaining courses. What next?`
      : `${args.register} · ${args.remaining} course(s) left. What next?`,
    options,
    initialValue: options[0]!.value,
  })
  if (p.isCancel(selected)) return 'done'
  return selected as SessionNext
}

export async function runSurgicalEdit(opts: {
  mode: FixCourseMode
  input?: string
  previous?: string
  output?: string
  register?: string
  from?: string
  to?: string
  toTitle?: string
  course?: string
  nomenclature?: string
  skipPrompts?: boolean
  interactive: boolean
}): Promise<number> {
  await bannerAnimated()

  let inputPath = opts.input
  let previousDir = opts.previous
  let outDir = opts.output

  if (!inputPath && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick last-run enrollment workbook…')
    inputPath =
      (await pickEnrollmentFile('Select enrollment Excel from the last main run')) ?? undefined
    pick.stop(inputPath ? spinOk(path.basename(inputPath)) : spinWarn('Cancelled'))
  }
  if (!previousDir && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick previous output folder…')
    previousDir = (await pickPreviousOutputFolder()) ?? undefined
    pick.stop(previousDir ? spinOk(path.basename(previousDir)) : spinWarn('Cancelled'))
  }
  if (!outDir && opts.interactive) {
    const pick = p.spinner()
    pick.start('Pick new output folder…')
    outDir = (await pickOutputFolder('Choose folder for surgical-fix exports')) ?? undefined
    pick.stop(
      outDir ? spinOk(path.basename(outDir)) : spinWarn('Cancelled — using ./unislot-out-fix'),
    )
    outDir = outDir || path.join(process.cwd(), 'unislot-out-fix')
  }

  if (!inputPath || !previousDir) {
    p.log.error(
      `${opts.mode} requires -i (enrollment) and --previous (output folder with snapshot.json).`,
    )
    return 1
  }
  outDir = outDir || path.join(process.cwd(), 'unislot-out-fix')

  try {
    await assertReadableFile(inputPath)
    await assertSnapshotFolder(previousDir)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  let snapshot: SchedulingSnapshot
  try {
    snapshot = await loadSchedulingSnapshot(previousDir)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  const session = opts.interactive && !opts.skipPrompts

  let programNomenclatureXlsx: ArrayBuffer | undefined
  if (opts.nomenclature) {
    try {
      await assertReadableFile(opts.nomenclature)
      const nomBuffer = await readFile(opts.nomenclature)
      programNomenclatureXlsx = nomBuffer.buffer.slice(
        nomBuffer.byteOffset,
        nomBuffer.byteOffset + nomBuffer.byteLength,
      )
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err))
      return 1
    }
  }

  const inferredSaturday = inferAllowSaturdayFromSnapshot(snapshot)
  const inferredExtras = inferSaturdayExtrasFromSnapshot(snapshot)

  let register = opts.register ? cleanRegisterNumber(opts.register) : ''
  let fromCode = opts.from ? cleanCourseCode(opts.from) : ''
  let dropCode = opts.course ? cleanCourseCode(opts.course) : ''
  let toCode = opts.to ? cleanCourseCode(opts.to) : ''
  let toTitle = opts.toTitle?.trim() || undefined
  let edits = 0
  let lastFiles: string[] = []

  const finish = async (code: number): Promise<number> => {
    if (edits === 0) return code
    await outroSuccess([
      chalk.green(edits === 1 ? 'Surgical edit complete.' : `${edits} surgical edits complete.`),
      chalk.dim(`Previous folder unchanged: ${previousDir}`),
      ...lastFiles.map((f) => chalk.dim('  · ') + f),
    ])
    return 0
  }

  const abortOrFinish = async (): Promise<number> => {
    if (edits > 0) return finish(0)
    p.cancel('Cancelled')
    return 1
  }

  const clearEditFields = (): void => {
    fromCode = ''
    dropCode = ''
    toCode = ''
    toTitle = undefined
  }

  while (true) {
    if (!register) {
      if (!session) {
        p.log.error('Register number is required (--register).')
        return 1
      }
      const answer = await p.text({
        message: 'Student register number',
        placeholder: 'e.g. RA2111003010001',
      })
      if (p.isCancel(answer)) return abortOrFinish()
      register = cleanRegisterNumber(String(answer ?? ''))
      if (!register) {
        p.log.error('Register number is required.')
        continue
      }
    }

    let courses
    try {
      courses = listStudentCourses(snapshot, register)
    } catch (err) {
      if (err instanceof StudentCourseEditError) {
        p.log.error(err.message)
        if (!session) return 1
        register = ''
        clearEditFields()
        continue
      }
      throw err
    }
    if (!courses.length) {
      p.log.error(`${register} has no course enrollments in this snapshot.`)
      if (!session) return 1
      register = ''
      clearEditFields()
      continue
    }

    p.log.info(
      `${register} · ${courses.length} course(s): ` + courses.map((c) => c.course_code).join(', '),
    )

    if (opts.mode === 'fix-course') {
      if (!fromCode && session) {
        const selected = await p.select({
          message: 'Which course code is wrong?',
          options: courseSelectOptions(courses, true),
        })
        if (p.isCancel(selected)) return abortOrFinish()
        if (String(selected) === SWITCH_STUDENT) {
          register = ''
          clearEditFields()
          continue
        }
        fromCode = String(selected)
      }
      if (!toCode && session) {
        const answer = await p.text({
          message: 'Correct course code (existing on schedule, or new — CP-SAT will place it)',
          placeholder: 'e.g. 21MAB310T',
        })
        if (p.isCancel(answer)) return abortOrFinish()
        toCode = cleanCourseCode(String(answer ?? ''))
      }
      if (!fromCode || !toCode) {
        p.log.error('fix-course requires --from and --to (or interactive prompts).')
        return await finish(1)
      }
      const targetExists = Boolean(snapshot.courseSections[toCode]?.length)
      if (!targetExists && session) {
        p.log.warn(
          `${toCode} is not on this schedule — a new course will be created and placed with CP-SAT (existing weekdays stay frozen).`,
        )
      }
      if (!toTitle && session) {
        const existingTitle =
          snapshot.courseSections[toCode]?.[0]?.course_title ||
          snapshot.enrollmentRows.find((r) => r.course_code === toCode)?.course_title ||
          ''
        if (!existingTitle) {
          const answer = await p.text({
            message: targetExists
              ? 'Correct course title (optional)'
              : 'New course title (recommended)',
            placeholder: 'Leave blank if unknown',
          })
          if (p.isCancel(answer)) return abortOrFinish()
          toTitle = String(answer ?? '').trim() || undefined
        }
      }
    } else {
      if (!dropCode && session) {
        const selected = await p.select({
          message: `Remove ${register} from which of ${courses.length} course(s)?`,
          options: courseSelectOptions(courses, true),
        })
        if (p.isCancel(selected)) return abortOrFinish()
        if (String(selected) === SWITCH_STUDENT) {
          register = ''
          clearEditFields()
          continue
        }
        dropCode = String(selected)
      }
      if (!dropCode) {
        p.log.error('drop-course requires --course (or interactive prompts).')
        return await finish(1)
      }
    }

    if (session) {
      const creatingNew =
        opts.mode === 'fix-course' && toCode && !snapshot.courseSections[toCode]?.length
      const summary =
        opts.mode === 'fix-course'
          ? creatingNew
            ? `Move ${register}: ${fromCode} → ${toCode} (new course · CP-SAT places weekday · others stay frozen)`
            : `Move ${register}: ${fromCode} → ${toCode} (others stay frozen)`
          : `Drop ${register} from ${dropCode} (others stay frozen)`
      const ok = await p.confirm({ message: summary, initialValue: true })
      if (p.isCancel(ok)) return abortOrFinish()
      if (!ok) {
        clearEditFields()
        continue
      }
    }

    const spin = p.spinner()
    spin.start(opts.mode === 'fix-course' ? 'Fixing course assignment…' : 'Dropping course…')
    try {
      const result = await runFixPipeline(
        (ev) => {
          if (ev.message) spin.message(ev.message)
        },
        {
          previousSnapshot: snapshot,
          mode: opts.mode,
          fix:
            opts.mode === 'fix-course'
              ? { register, fromCode, toCode, toTitle }
              : undefined,
          drop: opts.mode === 'drop-course' ? { register, courseCode: dropCode } : undefined,
          inputFileName: path.basename(inputPath),
          previousDir,
          outputDir: outDir,
          programNomenclatureXlsx,
          allowSaturdayForMath: inferredSaturday,
          saturdayExtraCourseCodes: inferredExtras,
          seed: snapshot.seed,
        },
      )

      if (result.infeasible) {
        spin.stop(spinWarn('Aborted'))
        p.log.error(result.infeasible_reason || 'Surgical edit aborted.')
        if (!session) return 1
        clearEditFields()
        continue
      }

      spin.stop(spinOk('Done'))
      const report = result.editReport
      if (report) {
        const lines = [
          chalk.bold(opts.mode === 'fix-course' ? 'Course fixed' : 'Course dropped'),
          `  ${chalk.cyan(report.register_number)}`,
          opts.mode === 'fix-course'
            ? `  ${report.removed_course} → ${report.added_course}` +
              (report.target_section_id ? ` · ${report.target_section_id}` : '')
            : `  removed ${report.removed_course}`,
        ]
        if (report.created_new_course) {
          lines.push(
            `  new course placed via ${report.placement_method}` +
              (report.new_course_slot !== undefined
                ? ` · weekday slot ${report.new_course_slot}`
                : ''),
          )
        }
        if (report.pruned_courses.length) {
          lines.push(`  pruned empty: ${report.pruned_courses.join(', ')}`)
        }
        lines.push(
          `  RED ${report.red_before} → ${report.red_after}`,
          '',
          chalk.dim("Other students' days and sections were not changed."),
        )
        showPanel('Surgical edit', lines.join('\n'))
      }

      if (result.schedulingSnapshot) snapshot = result.schedulingSnapshot

      await playWriteSweep()
      const writeSpin = p.spinner()
      writeSpin.start(`Writing exports to ${outDir}…`)
      lastFiles = await writeFixExports(outDir, result)
      writeSpin.stop(spinOk(`${lastFiles.length} file(s)`))
      for (const f of lastFiles) p.log.info(chalk.dim(f))
      edits += 1
      clearEditFields()

      if (!session) return finish(0)

      const studentRemoved = Boolean(report?.student_removed)
      let remaining = 0
      if (!studentRemoved) {
        try {
          remaining = listStudentCourses(snapshot, register).length
        } catch {
          remaining = 0
        }
      }

      const next = await promptSessionNext({
        mode: opts.mode,
        register,
        remaining,
        studentRemoved,
      })
      if (next === 'done') return finish(0)
      if (next === 'other-student' || remaining === 0 || studentRemoved) {
        register = ''
      }
    } catch (err) {
      spin.stop(spinWarn('Failed'))
      const message =
        err instanceof StudentCourseEditError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      p.log.error(message)
      if (!session) return 1
      clearEditFields()
    }
  }
}
