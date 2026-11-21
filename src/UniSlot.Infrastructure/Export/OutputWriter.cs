using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using UniSlot.Application.Workflow;

namespace UniSlot.Infrastructure.Export;

public static class OutputWriter
{
    public const string ScheduleFile = "schedule.xlsx";
    public const string ClashFile = "clash-report.xlsx";
    public const string EmailsFile = "course-emails.xlsx";
    public const string SnapshotFile = "snapshot.json";
    public const string SummaryFile = "summary.json";
    public const string EnrollmentFile = "enrollment.xlsx";
    public const string RunLogFile = "run-log.json";
    public const string NameListFile = "name-list.xlsx";
    public const string FilteredScheduleFile = "schedule-filtered.xlsx";

    /// <summary>Writes the five-file output folder. Files are written to temporary names first, so a failure never leaves a half-written folder.</summary>
    public static async Task<IReadOnlyList<string>> WriteAsync(SolveOutcome outcome, string directory, ExportOptions? options = null, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        options ??= new ExportOptions();
        Directory.CreateDirectory(directory);
        var at = DateTimeOffset.UtcNow;

        var jobs = new (string Name, Func<byte[]> Render)[]
        {
            (ScheduleFile, () => Render(ScheduleWorkbook.Build(outcome, options))),
            (ClashFile, () => Render(ClashWorkbook.Build(outcome, options))),
            (EmailsFile, () => Render(EmailsWorkbook.Build(outcome, options))),
            (SnapshotFile, () => Encoding.UTF8.GetBytes(SnapshotJson.Build(outcome, at).ToJsonString(SnapshotJson.Options))),
            (SummaryFile, () => Encoding.UTF8.GetBytes(SummaryJson.Build(outcome).ToJsonString(SnapshotJson.Options))),
        };

        if (outcome.Settings.Edit is { } edit)
        {
            // Edit runs also leave the corrected enrollment, a report of what changed, and the cumulative run log.
            jobs =
            [
                .. jobs,
                (EnrollmentFile, () => Render(NameListWorkbook.Build(outcome.Roster.Rows))),
                (EditReportJson.FileName(edit.Mode), () => Encoding.UTF8.GetBytes(EditReportJson.Build(outcome).ToJsonString(SnapshotJson.Options))),
                (RunLogFile, () => Encoding.UTF8.GetBytes((SnapshotJson.Build(outcome, at)["run_log"] ?? new System.Text.Json.Nodes.JsonArray()).ToJsonString(SnapshotJson.Options))),
            ];
        }

        var rendered = await Task.WhenAll(jobs.Select(j => Task.Run(() => (j.Name, Bytes: j.Render()), ct))).ConfigureAwait(false);

        var temp = rendered.Select(r => (r.Name, Temp: Path.Combine(directory, r.Name + ".tmp"), r.Bytes)).ToList();
        try
        {
            foreach (var t in temp) await File.WriteAllBytesAsync(t.Temp, t.Bytes, ct).ConfigureAwait(false);
            foreach (var t in temp) File.Move(t.Temp, Path.Combine(directory, t.Name), overwrite: true);
        }
        finally
        {
            foreach (var t in temp) if (File.Exists(t.Temp)) File.Delete(t.Temp);
        }
        return [.. temp.Select(t => Path.Combine(directory, t.Name))];
    }

    /// <summary>Writes only the name list (the enrollment sheet in input layout) for a saved schedule.</summary>
    public static async Task<string> WriteNameListAsync(IReadOnlyList<UniSlot.Domain.EnrollmentRow> rows, string directory, CancellationToken ct = default)
    {
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, NameListFile);
        await File.WriteAllBytesAsync(path, Render(NameListWorkbook.Build(rows)), ct).ConfigureAwait(false);
        return path;
    }

    /// <summary>Writes only <c>schedule-filtered.xlsx</c> for an outcome built from a course subset.</summary>
    public static async Task<string> WriteScheduleOnlyAsync(SolveOutcome outcome, string directory, ExportOptions? options = null, CancellationToken ct = default)
    {
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, FilteredScheduleFile);
        byte[] bytes = await Task.Run(() => Render(ScheduleWorkbook.Build(outcome, options ?? new ExportOptions())), ct).ConfigureAwait(false);
        await File.WriteAllBytesAsync(path, bytes, ct).ConfigureAwait(false);
        return path;
    }

    private static byte[] Render(XLWorkbook workbook)
    {
        using (workbook)
        using (var ms = new MemoryStream())
        {
            workbook.SaveAs(ms);
            return ms.ToArray();
        }
    }
}
