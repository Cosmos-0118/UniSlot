import ExcelJS from 'exceljs'
import type { ClashReport, StudentClashReport } from './types'
import { DAY_FILL, XL } from './excelStyleConstants'

function writeBufferToArrayBuffer(buf: unknown): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
  throw new Error('Unexpected workbook buffer type')
}

function clashers(report: ClashReport): StudentClashReport[] {
  return report.reports.filter((r) => r.status === 'Red')
}

/**
 * Rich clash workbook matching legacy `export_clash_report_xlsx` structure and grouping.
 */
export async function clashReportToRichWorkbookBuffer(report: ClashReport): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const red = clashers(report)

  // ---------- Summary ----------
  const wsSummary = wb.addWorksheet('Summary')
  wsSummary.mergeCells('A1:D1')
  const title = wsSummary.getCell('A1')
  title.value = 'CLASH REPORT'
  title.font = { bold: true, size: 16, color: { argb: XL.white } }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  wsSummary.getRow(1).height = 35

  let row = 3
  wsSummary.mergeCells(`A${row}:D${row}`)
  const statusText =
    report.students_with_clashes === 0
      ? 'ALL CLEAR — No Scheduling Conflicts!'
      : `ATTENTION REQUIRED — ${report.students_with_clashes} Students Have Conflicts`
  const statusCell = wsSummary.getCell(`A${row}`)
  statusCell.value = statusText
  statusCell.font = {
    bold: true,
    size: 14,
    color: { argb: report.students_with_clashes === 0 ? XL.success : XL.danger },
  }
  statusCell.alignment = { horizontal: 'center', vertical: 'middle' }
  wsSummary.getRow(row).height = 32
  row += 2

  wsSummary.mergeCells(`A${row}:D${row}`)
  const km = wsSummary.getCell(`A${row}`)
  km.value = 'KEY METRICS'
  km.font = { bold: true, size: 13, color: { argb: XL.white } }
  km.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.secondary } }
  wsSummary.getRow(row).height = 28
  row += 1

  const metrics: [string, string | number, string][] = [
    ['Total Students Analyzed', report.total_students, 'students'],
    ['Students with Clashes', report.students_with_clashes, 'students'],
    ['Clash-Free Students', report.clash_free_students, 'students'],
    ['Clash Rate', `${report.clash_percentage.toFixed(2)}%`, ''],
    ['Success Rate', `${(100 - report.clash_percentage).toFixed(2)}%`, ''],
  ]
  for (const [name, val, unit] of metrics) {
    wsSummary.getCell(row, 1).value = name
    wsSummary.getCell(row, 1).font = { size: 11 }
    const vc = wsSummary.getCell(row, 2)
    vc.value = val
    let colorArgb: string = XL.primaryLight
    if (name.includes('Clashes') && typeof val === 'number') colorArgb = val > 0 ? XL.danger : XL.success
    else if (name.includes('Success') || name.includes('Free')) colorArgb = XL.success
    vc.font = { bold: true, size: 12, color: { argb: colorArgb } }
    wsSummary.getCell(row, 3).value = unit
    wsSummary.getCell(row, 3).font = { size: 10, color: { argb: XL.textMuted } }
    row++
  }
  row += 1

  if (red.length) {
    wsSummary.mergeCells(`A${row}:D${row}`)
    const ca = wsSummary.getCell(`A${row}`)
    ca.value = 'CLASH ANALYSIS'
    ca.font = { bold: true, size: 13, color: { argb: XL.white } }
    ca.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.danger } }
    wsSummary.getRow(row).height = 28
    row += 1

    const dayClashes = new Map<string, number>()
    for (const s of red) {
      if (s.clashing_day) dayClashes.set(s.clashing_day, (dayClashes.get(s.clashing_day) ?? 0) + 1)
    }
    wsSummary.getCell(row, 1).value = 'Clashes by Day:'
    wsSummary.getCell(row, 1).font = { bold: true, size: 11 }
    row++
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const) {
      const count = dayClashes.get(day) ?? 0
      if (count > 0) {
        wsSummary.getCell(row, 1).value = `  • ${day}`
        wsSummary.getCell(row, 2).value = count
        wsSummary.getCell(row, 2).font = { bold: true, color: { argb: XL.danger } }
        wsSummary.getCell(row, 3).value = 'students'
        row++
      }
    }
    row++

    const programClashes = new Map<string, number>()
    for (const s of red) {
      programClashes.set(s.program, (programClashes.get(s.program) ?? 0) + 1)
    }
    wsSummary.getCell(row, 1).value = 'Clashes by Program:'
    wsSummary.getCell(row, 1).font = { bold: true, size: 11 }
    row++
    for (const [program, count] of [...programClashes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      wsSummary.getCell(row, 1).value = `  • ${program.length > 30 ? `${program.slice(0, 30)}…` : program}`
      wsSummary.getCell(row, 2).value = count
      wsSummary.getCell(row, 2).font = { bold: true, color: { argb: XL.danger } }
      row++
    }
    row++

    const pairCounts = new Map<string, number>()
    for (const s of red) {
      for (const [a, b] of s.clashing_courses) {
        const key = [a, b].sort().join('|')
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
    wsSummary.getCell(row, 1).value = 'Most Problematic Course Pairs:'
    wsSummary.getCell(row, 1).font = { bold: true, size: 11 }
    row++
    for (const [key, count] of [...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      const [c1, c2] = key.split('|')
      wsSummary.getCell(row, 1).value = `  • ${c1} & ${c2}`
      wsSummary.getCell(row, 2).value = count
      wsSummary.getCell(row, 2).font = { bold: true, color: { argb: XL.danger } }
      wsSummary.getCell(row, 3).value = 'students affected'
      row++
    }
  }

  wsSummary.getColumn(1).width = 35
  wsSummary.getColumn(2).width = 15
  wsSummary.getColumn(3).width = 20
  wsSummary.getColumn(4).width = 20

  // ---------- Clashes Only ----------
  const wsC = wb.addWorksheet('Clashes Only')
  if (red.length) {
    wsC.mergeCells('A1:G1')
    const h = wsC.getCell('A1')
    h.value = `STUDENTS WITH SCHEDULING CONFLICTS (${red.length})`
    h.font = { bold: true, size: 14, color: { argb: XL.white } }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.danger } }
    h.alignment = { horizontal: 'center', vertical: 'middle' }
    wsC.getRow(1).height = 32

    let r = 3
    const heads = ['S.No', 'Register No.', 'Student Name', 'Program', 'Enrolled Courses', 'Clashing Courses', 'Clash Day']
    heads.forEach((text, i) => {
      const c = wsC.getRow(r).getCell(i + 1)
      c.value = text
      c.font = { bold: true, color: { argb: XL.white } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    wsC.getRow(r).height = 28
    r++

    const sorted = [...red].sort(
      (a, b) => a.program.localeCompare(b.program) || a.student_name.localeCompare(b.student_name),
    )
    sorted.forEach((student, idx) => {
      const clashText = student.clashing_courses.map(([c1, c2]) => `${c1} & ${c2}`).join('; ')
      const vals = [
        idx + 1,
        student.register_number,
        student.student_name,
        student.program,
        student.enrolled_courses.join(', '),
        clashText,
        student.clashing_day ?? '',
      ]
      vals.forEach((v, i) => {
        const cell = wsC.getRow(r).getCell(i + 1)
        cell.value = v
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.clashRow } }
        cell.alignment =
          i === 0 || i === 6
            ? { horizontal: 'center', vertical: 'middle' }
            : { horizontal: 'left', vertical: 'middle', wrapText: false }
      })
      wsC.getRow(r).height = 22
      r++
    })
    ;[6, 18, 28, 50, 30, 32, 14].forEach((w, i) => {
      wsC.getColumn(i + 1).width = w
    })
  } else {
    wsC.mergeCells('A1:C1')
    const c = wsC.getCell('A1')
    c.value = 'No clashes! All students have conflict-free schedules.'
    c.font = { bold: true, size: 14, color: { argb: XL.success } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
  }

  // ---------- By Program ----------
  const wsP = wb.addWorksheet('By Program')
  wsP.mergeCells('A1:E1')
  const pTitle = wsP.getCell('A1')
  pTitle.value = 'CLASHES BY PROGRAM'
  pTitle.font = { bold: true, size: 16, color: { argb: XL.white } }
  pTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  pTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  wsP.getRow(1).height = 35
  let rp = 3
  if (red.length) {
    const programGroups = new Map<string, StudentClashReport[]>()
    for (const s of red) {
      if (!programGroups.has(s.program)) programGroups.set(s.program, [])
      programGroups.get(s.program)!.push(s)
    }
    for (const program of [...programGroups.keys()].sort()) {
      const students = programGroups.get(program)!
      wsP.mergeCells(`A${rp}:E${rp}`)
      const band = wsP.getCell(`A${rp}`)
      band.value = `${program} — ${students.length} students with clashes`
      band.font = { bold: true, size: 12, color: { argb: XL.white } }
      band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.secondary } }
      band.alignment = { horizontal: 'left', vertical: 'middle' }
      wsP.getRow(rp).height = 26
      rp++

      const ph = ['#', 'Register No.', 'Name', 'Clashing Courses', 'Day']
      ph.forEach((text, i) => {
        const c = wsP.getRow(rp).getCell(i + 1)
        c.value = text
        c.font = { bold: true, color: { argb: XL.white } }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
        c.alignment = { horizontal: 'center', vertical: 'middle' }
      })
      wsP.getRow(rp).height = 24
      rp++

      const sortedS = [...students].sort((a, b) => a.student_name.localeCompare(b.student_name))
      sortedS.forEach((student, idx) => {
        const clashText = student.clashing_courses.map(([c1, c2]) => `${c1} & ${c2}`).join('; ')
        const vals = [idx + 1, student.register_number, student.student_name, clashText, student.clashing_day ?? '']
        vals.forEach((v, i) => {
          const cell = wsP.getRow(rp).getCell(i + 1)
          cell.value = v
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.clashRow } }
          cell.alignment =
            i === 0 || i === 4 ? { horizontal: 'center', vertical: 'middle' } : { horizontal: 'left', vertical: 'middle' }
        })
        wsP.getRow(rp).height = 22
        rp++
      })
      rp++
    }
    ;[5, 18, 28, 35, 14].forEach((w, i) => {
      wsP.getColumn(i + 1).width = w
    })
  } else {
    wsP.getCell(rp, 1).value = 'No clashes to display.'
    wsP.getCell(rp, 1).font = { italic: true }
  }

  // ---------- By Day ----------
  const wsD = wb.addWorksheet('By Day')
  wsD.mergeCells('A1:E1')
  const dTitle = wsD.getCell('A1')
  dTitle.value = 'CLASHES BY DAY'
  dTitle.font = { bold: true, size: 16, color: { argb: XL.white } }
  dTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  dTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  wsD.getRow(1).height = 35
  let rd = 3
  if (red.length) {
    const dayGroups = new Map<string, StudentClashReport[]>()
    for (const s of red) {
      if (!s.clashing_day) continue
      if (!dayGroups.has(s.clashing_day)) dayGroups.set(s.clashing_day, [])
      dayGroups.get(s.clashing_day)!.push(s)
    }
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const) {
      const students = dayGroups.get(day)
      if (!students?.length) continue
      const dayArgb = DAY_FILL[day] ?? XL.rowAlt
      wsD.mergeCells(`A${rd}:E${rd}`)
      const dh = wsD.getCell(`A${rd}`)
      dh.value = `${day.toUpperCase()} — ${students.length} clashes`
      dh.font = { bold: true, size: 13, color: { argb: XL.white } }
      dh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
      dh.alignment = { horizontal: 'left', vertical: 'middle' }
      wsD.getRow(rd).height = 28
      rd++

      const dh2 = ['#', 'Register No.', 'Name', 'Program', 'Clashing Courses']
      dh2.forEach((text, i) => {
        const c = wsD.getRow(rd).getCell(i + 1)
        c.value = text
        c.font = { bold: true, color: { argb: XL.white } }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
        c.alignment = { horizontal: 'center', vertical: 'middle' }
      })
      wsD.getRow(rd).height = 24
      rd++

      students.forEach((student, idx) => {
        const clashText = student.clashing_courses.map(([c1, c2]) => `${c1} & ${c2}`).join('; ')
        const vals = [idx + 1, student.register_number, student.student_name, student.program, clashText]
        vals.forEach((v, i) => {
          const cell = wsD.getRow(rd).getCell(i + 1)
          cell.value = v
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dayArgb } }
          cell.alignment = i === 0 ? { horizontal: 'center', vertical: 'middle' } : { horizontal: 'left', vertical: 'middle' }
        })
        wsD.getRow(rd).height = 22
        rd++
      })
      rd++
    }
    ;[5, 18, 28, 50, 35].forEach((w, i) => {
      wsD.getColumn(i + 1).width = w
    })
  } else {
    wsD.getCell(rd, 1).value = 'No clashes to display.'
    wsD.getCell(rd, 1).font = { italic: true }
  }

  // ---------- By Course (pairs) ----------
  const wsPair = wb.addWorksheet('By Course')
  wsPair.mergeCells('A1:D1')
  const pairTitle = wsPair.getCell('A1')
  pairTitle.value = 'CLASH ANALYSIS BY COURSE PAIR'
  pairTitle.font = { bold: true, size: 16, color: { argb: XL.white } }
  pairTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  pairTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  wsPair.getRow(1).height = 35
  let rk = 3
  if (red.length) {
    const pairStudents = new Map<string, StudentClashReport[]>()
    for (const s of red) {
      for (const [a, b] of s.clashing_courses) {
        const key = [a, b].sort().join('\t')
        if (!pairStudents.has(key)) pairStudents.set(key, [])
        pairStudents.get(key)!.push(s)
      }
    }
    const heads = ['Rank', 'Course Pair', 'Students Affected', 'Programs Affected']
    heads.forEach((text, i) => {
      const c = wsPair.getRow(rk).getCell(i + 1)
      c.value = text
      c.font = { bold: true, color: { argb: XL.white } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    wsPair.getRow(rk).height = 26
    rk++

    const sortedPairs = [...pairStudents.entries()].sort((a, b) => b[1].length - a[1].length)
    sortedPairs.forEach(([key, students], rank) => {
      const [c1, c2] = key.split('\t')
      const programs = [...new Set(students.map((s) => s.program))].sort()
      const progStr = programs.slice(0, 3).join(', ') + (programs.length > 3 ? '…' : '')
      const vals = [rank + 1, `${c1} & ${c2}`, students.length, progStr]
      vals.forEach((v, i) => {
        const cell = wsPair.getRow(rk).getCell(i + 1)
        cell.value = v
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.clashRow } }
        cell.alignment =
          i === 0 || i === 2 ? { horizontal: 'center', vertical: 'middle' } : { horizontal: 'left', vertical: 'middle' }
      })
      wsPair.getRow(rk).height = 22
      rk++
    })
    ;[6, 35, 18, 45].forEach((w, i) => {
      wsPair.getColumn(i + 1).width = w
    })
  } else {
    wsPair.getCell(rk, 1).value = 'No clashes to analyze.'
    wsPair.getCell(rk, 1).font = { italic: true }
  }

  // ---------- Full Report ----------
  const wsF = wb.addWorksheet('Full Report')
  wsF.mergeCells('A1:G1')
  const fTitle = wsF.getCell('A1')
  fTitle.value = 'COMPLETE STUDENT STATUS REPORT'
  fTitle.font = { bold: true, size: 14, color: { argb: XL.white } }
  fTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  fTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  wsF.getRow(1).height = 32

  let rf = 3
  const fh = ['S.No', 'Register No.', 'Student Name', 'Program', 'Enrolled Courses', 'Status', 'Clash Details']
  fh.forEach((text, i) => {
    const c = wsF.getRow(rf).getCell(i + 1)
    c.value = text
    c.font = { bold: true, color: { argb: XL.white } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  wsF.getRow(rf).height = 28
  rf++

  const sortedAll = [...report.reports].sort(
    (a, b) =>
      (a.status === 'Red' ? 0 : 1) - (b.status === 'Red' ? 0 : 1) ||
      a.program.localeCompare(b.program) ||
      a.student_name.localeCompare(b.student_name),
  )
  sortedAll.forEach((student, idx) => {
    const clashText =
      student.clashing_courses.length > 0
        ? student.clashing_courses.map(([c1, c2]) => `${c1} & ${c2}`).join('; ')
        : '—'
    const statusText = student.status === 'Red' ? 'CLASH' : 'OK'
    const vals = [
      idx + 1,
      student.register_number,
      student.student_name,
      student.program,
      student.enrolled_courses.join(', '),
      statusText,
      clashText,
    ]
    const fillArgb = student.status === 'Red' ? XL.clashRow : idx % 2 === 0 ? XL.rowAlt : XL.white
    vals.forEach((v, i) => {
      const cell = wsF.getRow(rf).getCell(i + 1)
      cell.value = v
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
      cell.alignment =
        i === 0 || i === 5 ? { horizontal: 'center', vertical: 'middle' } : { horizontal: 'left', vertical: 'middle' }
    })
    wsF.getRow(rf).height = 22
    rf++
  })
  ;[6, 18, 28, 50, 30, 10, 32].forEach((w, i) => {
    wsF.getColumn(i + 1).width = w
  })

  const buf = await wb.xlsx.writeBuffer()
  return writeBufferToArrayBuffer(buf)
}
