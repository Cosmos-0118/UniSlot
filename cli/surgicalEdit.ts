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

  let register = opts.register ? cleanRegisterNumber(opts.register) : ''
  if (!register && opts.interactive && !opts.skipPrompts) {
    const answer = await p.text({
      message: 'Student register number',
      placeholder: 'e.g. RA2111003010001',
    })
    if (p.isCancel(answer)) {
      p.cancel('Cancelled')
      return 1
    }
    register = cleanRegisterNumber(String(answer ?? ''))
  }
  if (!register) {
    p.log.error('Register number is required (--register).')
    return 1
  }

  let courses
  try {
    courses = listStudentCourses(snapshot, register)
  } catch (err) {
    if (err instanceof StudentCourseEditError) {
      p.log.error(err.message)
      return 1
    }
    throw err
  }
  if (!courses.length) {
    p.log.error(`${register} has no course enrollments in this snapshot.`)
    return 1
  }

  p.log.info(
    `${register} · ${courses.length} course(s): ` + courses.map((c) => c.course_code).join(', '),
  )

  let fromCode = opts.from ? cleanCourseCode(opts.from) : ''
  let dropCode = opts.course ? cleanCourseCode(opts.course) : ''
  let toCode = opts.to ? cleanCourseCode(opts.to) : ''
  let toTitle = opts.toTitle?.trim() || undefined

  if (opts.mode === 'fix-course') {
    if (!fromCode && opts.interactive && !opts.skipPrompts) {
      const selected = await p.select({
        message: 'Which course code is wrong?',
        options: courses.map((c) => ({
          value: c.course_code,
          label: c.course_title ? `${c.course_code} — ${c.course_title}` : c.course_code,
        })),
      })
      if (p.isCancel(selected)) {
        p.cancel('Cancelled')
        return 1
      }
      fromCode = String(selected)
    }
    if (!toCode && opts.interactive && !opts.skipPrompts) {
      const answer = await p.text({
        message: 'Correct course code (must already be on this schedule)',
        placeholder: 'e.g. 21MAB310T',
      })
      if (p.isCancel(answer)) {
        p.cancel('Cancelled')
        return 1
      }
      toCode = cleanCourseCode(String(answer ?? ''))
    }
    if (!fromCode || !toCode) {
      p.log.error('fix-course requires --from and --to (or interactive prompts).')
      return 1
    }
    if (!toTitle && opts.interactive && !opts.skipPrompts) {
      const existingTitle =
        snapshot.courseSections[toCode]?.[0]?.course_title ||
        snapshot.enrollmentRows.find((r) => r.course_code === toCode)?.course_title ||
        ''
      if (!existingTitle) {
        const answer = await p.text({
          message: 'Correct course title (optional)',
          placeholder: 'Leave blank if unknown',
        })
        if (p.isCancel(answer)) {
          p.cancel('Cancelled')
          return 1
        }
        toTitle = String(answer ?? '').trim() || undefined
      }
    }
  } else {
    if (!dropCode && opts.interactive && !opts.skipPrompts) {
      const selected = await p.select({
        message: 'Remove student from which course?',
        options: courses.map((c) => ({
          value: c.course_code,
          label: c.course_title ? `${c.course_code} — ${c.course_title}` : c.course_code,
        })),
      })
      if (p.isCancel(selected)) {
        p.cancel('Cancelled')
        return 1
      }
      dropCode = String(selected)
    }
    if (!dropCode) {
      p.log.error('drop-course requires --course (or interactive prompts).')
      return 1
    }
  }

  if (opts.interactive && !opts.skipPrompts) {
    const summary =
      opts.mode === 'fix-course'
        ? `Move ${register}: ${fromCode} → ${toCode} (others stay frozen)`
        : `Drop ${register} from ${dropCode} (others stay frozen)`
    const ok = await p.confirm({ message: summary, initialValue: true })
    if (p.isCancel(ok) || !ok) {
      p.cancel('Cancelled')
      return 1
    }
  }

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
      return 1
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

    await playWriteSweep()
    const writeSpin = p.spinner()
    writeSpin.start(`Writing exports to ${outDir}…`)
    const files = await writeFixExports(outDir, result)
    writeSpin.stop(spinOk(`${files.length} file(s)`))
    for (const f of files) p.log.info(chalk.dim(f))
    await outroSuccess([
      chalk.green('Surgical edit complete.'),
      chalk.dim(`Previous folder unchanged: ${previousDir}`),
      ...files.map((f) => chalk.dim('  · ') + f),
    ])
    return 0
  } catch (err) {
    spin.stop(spinWarn('Failed'))
    if (err instanceof StudentCourseEditError) {
      p.log.error(err.message)
      return 1
    }
    p.log.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}
